import { describe, it, expect } from 'vitest';
import { collidesCircleAABB, moveCircle, clamp, dist2 } from '../src/physics.js';

const wall = { x: 10, z: 0, w: 2, d: 10 }; // стена x: 9..11, z: -5..5

describe('collidesCircleAABB', () => {
  it('обнаруживает пересечение', () => {
    expect(collidesCircleAABB(8.8, 0, 0.5, wall)).toBe(true);
  });
  it('не пересекается на расстоянии', () => {
    expect(collidesCircleAABB(8.0, 0, 0.5, wall)).toBe(false);
  });
});

describe('moveCircle', () => {
  it('двигает свободно без препятствий', () => {
    const r = moveCircle(0, 0, 1, 0, 0.5, []);
    expect(r).toEqual({ x: 1, z: 0 });
  });
  it('блокирует ось, упирающуюся в стену', () => {
    const r = moveCircle(8, 0, 1.5, 0, 0.5, [wall]);
    expect(r.x).toBe(8);
  });
  it('позволяет скольжение вдоль стены', () => {
    const r = moveCircle(8, 0, 1.5, 3, 0.5, [wall]);
    expect(r.x).toBe(8);
    expect(r.z).toBe(3);
  });
});

describe('clamp / dist2', () => {
  it('clamp ограничивает значение', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
  });
  it('dist2 считает квадрат расстояния', () => {
    expect(dist2(0, 0, 3, 4)).toBe(25);
  });
});
