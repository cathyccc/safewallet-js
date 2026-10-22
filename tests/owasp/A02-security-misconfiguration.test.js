import request from 'supertest';
import {test, expect} from '../support/fixtures.js';

test('does not reveal the frameowkr in an X-Powered-By header', async ({app}) => {
  const res = await request(app).get('/health');
  expect(res.headers['x-powered-by']).toBeUndefined();
});

test('sends security headers', async ({app}) => {
  const res = await request(app).get('/health');
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
});

test('security headers are on error responses too', async ({app}) => {
  const res = await request(app)
    .post('/transfer')
    .send({});
  expect(res.status).toBe(401);
  expect(res.headers['x-content-type-options']).toBe('nosniff');
  expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
});

test('broken JSON returns a short 400, not a stack trace', async ({app}) => {
  const res = await request(app)
    .post('/transfer')
    .set('Content-Type', 'application/json')
    .send('{"amount": 5') //deliberately broken JSON
  expect(res.status).toBe(400);
  expect(res.body).toEqual({ error: 'invalid JSON body'});
  expect(res.text).not.toContain('SyntaxError');
});

test('unknown routes return a plain JSON 404', async ({app}) => {
  const res = await request(app).get('/does-not-exist');
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: 'not found' });
  expect(res.text).not.toContain('Cannot GET');
});