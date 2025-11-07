const request = require('supertest');
const app = require('../app');

// Mock rabbit and db so tests run without Docker
jest.mock('../services/rabbit', () => ({
  publish: jest.fn().mockResolvedValue(true),
  connect: jest.fn().mockResolvedValue(true),
}));
jest.mock('../services/db', () => ({
  query: jest.fn().mockResolvedValue([[]]),
}));

describe('POST /api/v1/scan/batch', () => {
  it('returns 400 when body missing epcs', async () => {
    const res = await request(app).post('/api/v1/scan/batch').send({});
    expect(res.statusCode).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('accepts valid payload and returns processed count', async () => {
    const payload = { reader_id: 'R1', epcs: ['EPC1', 'EPC2'] };
    const res = await request(app).post('/api/v1/scan/batch').send(payload);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('processed', 2);
  });
});
