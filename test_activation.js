const https = require('https');

async function testActivation() {
    const loginData = JSON.stringify({ username: "admin", password: "admin123" });

    const loginOpts = {
        hostname: 'api.trustygps.app',
        path: '/api/auth/login',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': loginData.length
        }
    };

    const token = await new Promise((resolve, reject) => {
        const req = https.request(loginOpts, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json.data.token);
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write(loginData);
        req.end();
    });

    const enrollOpts = {
        hostname: 'api.trustygps.app',
        path: '/api/devices/enroll',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    };

    const code = await new Promise((resolve, reject) => {
        const req = https.request(enrollOpts, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json.data.enrollmentCode);
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.write('{}');
        req.end();
    });

    console.log('Got code:', code);

    const activateData = JSON.stringify({
        enrollmentCode: code,
        platform: "android",
        appVersion: "1.0.0",
        deviceInfo: { androidId: "test-" + Date.now() }
    });

    const activateOpts = {
        hostname: 'api.trustygps.app',
        path: '/api/devices/activate',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': activateData.length
        }
    };

    const result = await new Promise((resolve, reject) => {
        const req = https.request(activateOpts, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', reject);
        req.write(activateData);
        req.end();
    });

    console.log('Activation result:', result);
}

testActivation().catch(console.error);
