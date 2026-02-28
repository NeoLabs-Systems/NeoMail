const fetch = require('node-fetch'); // wait, fetch is built-in in Node 18+

async function runTests() {
    const baseMail = 'http://localhost:3000/api/auth';

    // 1. Register a test user
    console.log('Registering test user...');
    const regRes = await fetch(`${baseMail}/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'sectestdoc', username: 'sectestdoc', email: 'sectestdoc@example.com', password: 'password123' })
    });
    console.log('Register:', regRes.status, await regRes.text());

    // 2. Login to get session cookie
    console.log('Logging in...');
    const loginRes = await fetch(`${baseMail}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'sectestdoc', password: 'password123' })
    });
    const loginData = await loginRes.json();
    const tokenHeader = `Bearer ${loginData.token}`;
    console.log('Login:', loginRes.status, 'Token length:', loginData.token?.length);

    // 3. Generate 2FA
    console.log('Generating 2FA...');
    const genRes = await fetch(`${baseMail}/2fa/generate`, {
        headers: { 'Authorization': tokenHeader }
    });
    const genData = await genRes.json();
    console.log('Generate:', genRes.status, genData.secret ? 'Secret generated' : genData);

    // 4. Verify with wrong token
    console.log('Verifying 2FA (wrong token)...');
    const verBadRes = await fetch(`${baseMail}/2fa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': tokenHeader },
        body: JSON.stringify({ token: '000000' })
    });
    console.log('Verify (bad):', verBadRes.status, await verBadRes.text());

    // Wait, we need the real token to enable 2FA
    const speakeasy = require('speakeasy');
    const token = speakeasy.totp({ secret: genData.secret, encoding: 'base32' });

    console.log('Verifying 2FA (correct token)...');
    const verGoodRes = await fetch(`${baseMail}/2fa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': tokenHeader },
        body: JSON.stringify({ token })
    });
    console.log('Verify (good):', verGoodRes.status, await verGoodRes.text());

    // 5. Check generate again when already enabled
    console.log('Generating 2FA (already enabled)...');
    const genRes2 = await fetch(`${baseMail}/2fa/generate`, {
        headers: { 'Authorization': tokenHeader }
    });
    console.log('Generate (2nd):', genRes2.status, await genRes2.text());

    // 6. Login again without 2FA
    console.log('Logging in (missing token)...');
    const loginRes2 = await fetch(`${baseMail}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'sectestdoc', password: 'password123' })
    });
    console.log('Login (missing token):', loginRes2.status, await loginRes2.text());

    // 7. Login again with wrong 2FA
    console.log('Logging in (wrong token)...');
    const loginRes3 = await fetch(`${baseMail}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'sectestdoc', password: 'password123', totp: '111111' })
    });
    console.log('Login (wrong token):', loginRes3.status, await loginRes3.text());

    // 8. Login again with correct 2FA
    const token2 = speakeasy.totp({ secret: genData.secret, encoding: 'base32' });
    console.log('Logging in (correct token)...');
    const loginRes4 = await fetch(`${baseMail}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'sectestdoc', password: 'password123', totp: token2 })
    });
    console.log('Login (correct token):', loginRes4.status);
}

runTests().catch(console.error);
