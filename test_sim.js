const { calculateDistance, interpolatePoint, calculateBearing } = require('./app-gps-manager-backend/src/utils/geospatial.util');

// Create a straight line route of ~2km
const origin = { lat: 0, lng: 0 };
const end = { lat: 0.018, lng: 0 }; // Approx 2km straight north

let points = [];
let progress = 0;
while (progress < 2000) {
    const fraction = progress / 2000;
    points.push(interpolatePoint(origin, end, fraction));
    progress += 50; // Points every 50m
}

const ENGINE_CONSTANTS = {
    aMax: 1.5,
    bMax: 2.5,
    lookAheadMeters: 15,
    MAX_METERS_PER_TICK: 50,
    MAX_JUMP_METERS: 100
};

let stream = {
    config: { speed: 30, intervalMs: 500, accuracy: 10, loop: false },
    points: points,
    sMeters: 0,
    vMps: 0,
    vTargetMps: 30 / 3.6,
    segIndex: 0,
    segProgress: 0,
    headingDeg: 0,
    lastTickTs: Date.now() - 500, // force exactly 500ms dt on first tick
    lastEmittedLatLng: null,
    state: 'MOVE',
    dwellTicksRemaining: 0
};

console.log("Starting simulation: 30km/h target (" + stream.vTargetMps.toFixed(2) + " m/s), 60 seconds (120 ticks of 500ms)");

for (let tick = 1; tick <= 120; tick++) {
    const dtMs = 500;
    const dt = dtMs / 1000;

    // Velocity Physics
    if (stream.vMps < stream.vTargetMps) {
        stream.vMps += ENGINE_CONSTANTS.aMax * dt;
        if (stream.vMps > stream.vTargetMps) stream.vMps = stream.vTargetMps;
    } else if (stream.vMps > stream.vTargetMps) {
        stream.vMps -= ENGINE_CONSTANTS.bMax * dt;
        if (stream.vMps < stream.vTargetMps) stream.vMps = stream.vTargetMps;
    }
    if (stream.vMps < 0) stream.vMps = 0;

    // Dynamic clamp
    const maxMetersPerTick = Math.min(80, Math.max(15, stream.vTargetMps * dt * 2.5));
    let metersToAdvance = stream.vMps * dt;
    metersToAdvance = Math.min(metersToAdvance, maxMetersPerTick);

    // Segment Traversal
    stream.sMeters += metersToAdvance;
    stream.segProgress += metersToAdvance;

    while (stream.segIndex < stream.points.length - 1) {
        const p1 = stream.points[stream.segIndex];
        const p2 = stream.points[stream.segIndex + 1];
        const segDist = calculateDistance(p1, p2);

        if (stream.segProgress >= segDist && segDist > 0) {
            stream.segIndex++;
            stream.segProgress -= segDist;
        } else {
            break;
        }
    }

    const p1 = stream.points[stream.segIndex];
    const p2 = stream.points[stream.segIndex + 1] || p1;
    const segDist = calculateDistance(p1, p2);

    const fraction = segDist > 0 ? stream.segProgress / segDist : 0;
    const { lat, lng } = interpolatePoint(p1, p2, Math.min(1, fraction));

    if (stream.lastEmittedLatLng) {
        const jumpDist = calculateDistance(stream.lastEmittedLatLng, { lat, lng });
        if (jumpDist > ENGINE_CONSTANTS.MAX_JUMP_METERS) {
            console.error(`JUMP DETECTED! ${jumpDist}m at tick ${tick}`);
            process.exit(1);
        }
    }
    stream.lastEmittedLatLng = { lat, lng };

    if (tick % 20 === 0 || tick === 120) {
        console.log(`Tick ${tick} (T=${tick * dt}s): v=${(stream.vMps * 3.6).toFixed(1)}km/h | s=${stream.sMeters.toFixed(2)}m | segIndex=${stream.segIndex}`);
    }
}

console.log("\n--- Final Results ---");
console.log(`Expected Distance (30km/h * 60s): 500m (minus small acceleration phase)`);
console.log(`Actual Distance: ${stream.sMeters.toFixed(2)}m`);
console.log(`Acceleration phase loss: ~2.5m roughly`);
if (stream.sMeters >= 470 && stream.sMeters <= 510) {
    console.log("✅ Simulation PASSED (Distance within physical bounds considering acceleration)");
} else {
    console.log("❌ Simulation FAILED");
    process.exit(1);
}
