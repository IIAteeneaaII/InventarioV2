import request from 'supertest';
import app from '../server.js';

describe('API de Logs - Casos de Prueba', () => {
  // TC101: Consultar logs de un equipo específico por ID
  it('TC101: Consulta logs de un equipo específico', async () => {
    const equipmentId = 1; // Usa un ID válido de tus pruebas
    const res = await request(app).get(`/api/logs/equipment/${equipmentId}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
    // Puedes agregar más validaciones según la estructura de tus logs
  });

  // TC102: Consultar logs de un lote completo
  it('TC102: Consulta logs de un lote completo', async () => {
    const lotId = 'LOT001'; // Usa un ID válido de tus pruebas
    const res = await request(app).get(`/api/logs/lot/${lotId}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
  });

  // TC103: Filtrar logs por rango de fechas
  it('TC103: Filtra logs por rango de fechas', async () => {
    const from = '2025-07-08T00:00:00Z';
    const to = '2025-07-09T00:00:00Z';
    const res = await request(app).get(`/api/logs/search?from=${from}&to=${to}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
    res.body.logs.forEach(log => {
      const ts = new Date(log.timestamp || log.message?.timestamp);
      expect(ts >= new Date(from) && ts <= new Date(to)).toBe(true);
    });
  });

  // TC104: Filtrar logs por nivel
  it('TC104: Filtra logs por nivel', async () => {
    const res = await request(app).get('/api/logs/search?level=INFO');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
    res.body.logs.forEach(log => {
      expect((log.level || log.message?.level)).toBe('INFO');
    });
  });

  // TC105: Búsqueda de logs por usuario responsable
  it('TC105: Busca logs por usuario responsable', async () => {
    const userId = 'anon'; // Cambia por un user_id real de tus pruebas
    const res = await request(app).get(`/api/logs/search?user_id=${userId}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
    res.body.logs.forEach(log => {
      expect((log.user_id || log.message?.user_id)).toBe(userId);
    });
  });

  // TC106: Consultar logs por tipo de operación
  it('TC106: Busca logs por tipo de operación', async () => {
    const operation = 'state_transition'; // Cambia según tus logs
    const res = await request(app).get(`/api/logs/search?operation=${operation}`);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
    res.body.logs.forEach(log => {
      expect((log.operation || log.message?.operation)).toBe(operation);
    });
  });

  // TC112: Listar todos los errores de transición inválida
  it('TC112: Lista errores de transición inválida', async () => {
    const res = await request(app).get('/api/logs/search?level=ERROR&operation=invalid_transition');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.logs)).toBe(true);
    res.body.logs.forEach(log => {
      expect((log.level || log.message?.level)).toBe('ERROR');
      expect((log.operation || log.message?.operation)).toBe('invalid_transition');
    });
  });
});