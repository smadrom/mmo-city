import { Room, type Client } from 'colyseus';
import {
  TICK_RATE, MAX_PLAYERS, COP_LIMIT, DELIVERY_PICKUP_DIST, DOOR_DIST,
  createCityMap, dist2, type AABB, type CityMap,
} from '@mmo/shared';
import { GameState, Player, Car, Apartment } from '../schema/GameState.js';
import { makeRuntime, type Runtime } from '../runtime.js';
import { GameDB } from '../db.js';
import { tickMovement } from '../systems/movement.js';
import { tickVehicles, tryEnterCar, tryExitCar, type CarRuntime } from '../systems/vehicles.js';
import { handleAttack, tickRespawn } from '../systems/combat.js';
import { tickPolice } from '../systems/police.js';
import { tryStartDelivery, tickDelivery } from '../systems/economy.js';
import { tryRent, adjustSafe, tickRent } from '../systems/housing.js';

const SAVE_INTERVAL_MS = 5000;

export class CityRoom extends Room<GameState> {
  maxClients = MAX_PLAYERS;

  private map!: CityMap;
  private colliders!: AABB[];
  private db!: GameDB;
  private runtimes = new Map<string, Runtime>();
  private carRuntime = new Map<string, CarRuntime>();
  private lastSaveAt = 0;

  onCreate(): void {
    this.map = createCityMap();
    this.colliders = this.map.buildings.map(b => ({ x: b.x, z: b.z, w: b.w, d: b.d }));
    this.db = new GameDB(process.env.GAME_DB ?? 'game.db');
    this.setState(new GameState());

    for (const spot of this.map.parkingSpots) {
      const car = new Car();
      car.id = spot.id;
      car.x = spot.x;
      car.z = spot.z;
      this.state.cars.set(spot.id, car);
      this.carRuntime.set(spot.id, { emptySince: 0 });
    }
    for (const door of this.map.apartments) {
      const a = new Apartment();
      a.id = door.id;
      a.doorX = door.x;
      a.doorZ = door.z;
      this.state.apartments.set(door.id, a);
    }

    this.setSimulationInterval((dtMs) => {
      try {
        this.tick(dtMs / 1000);
      } catch (err) {
        console.error('[city] tick error', err);
      }
    }, 1000 / TICK_RATE);

    this.onMessage('input', (client, data) => {
      const rt = this.runtimes.get(client.sessionId);
      if (!rt) return;
      rt.input = {
        up: !!data?.up, down: !!data?.down, left: !!data?.left, right: !!data?.right,
        sprint: !!data?.sprint, rotY: Number(data?.rotY) || 0,
      };
    });
    this.onMessage('attack', (client) => {
      handleAttack(this.state, this.runtimes, client.sessionId, Date.now());
    });
    this.onMessage('interact', (client) => this.handleInteract(client));
    this.onMessage('deposit', (client, data) => {
      adjustSafe(this.state, client.sessionId, Math.abs(Number(data?.amount) || 0));
    });
    this.onMessage('withdraw', (client, data) => {
      adjustSafe(this.state, client.sessionId, -Math.abs(Number(data?.amount) || 0));
    });
  }

  onJoin(client: Client, options: { name?: string; role?: string }): void {
    const name = String(options?.name ?? '').slice(0, 16) || `p${client.sessionId.slice(0, 6)}`;
    let role: 'citizen' | 'cop' = options?.role === 'cop' ? 'cop' : 'citizen';
    if (role === 'cop') {
      let cops = 0;
      this.state.players.forEach(pl => { if (pl.role === 'cop') cops++; });
      if (cops >= COP_LIMIT) role = 'citizen';
    }
    const rec = this.db.load(name);

    const p = new Player();
    p.name = name;
    p.role = role;
    const door = role === 'cop' ? this.map.policeDoor : this.map.hospitalDoor;
    p.x = door.x + Math.random() * 4 - 2;
    p.z = door.z + Math.random() * 2; // только в сторону от здания, чтобы не заспавнить в коллизии
    p.cash = rec.cash;
    p.safe = rec.safe;
    if (rec.apt) {
      const apt = this.state.apartments.get(rec.apt);
      if (apt && (!apt.rentedBy || apt.rentedBy === name)) {
        apt.rentedBy = name;
        p.apt = rec.apt;
      }
    }
    this.state.players.set(client.sessionId, p);

    const rt = makeRuntime(Date.now());
    rt.kills = rec.kills;
    rt.deaths = rec.deaths;
    this.runtimes.set(client.sessionId, rt);
  }

  async onLeave(client: Client, consented: boolean): Promise<void> {
    try {
      if (consented) throw new Error('consented leave');
      await this.allowReconnection(client, 10);
    } catch {
      this.removePlayer(client.sessionId);
    }
  }

  onDispose(): void {
    this.state.players.forEach((_p, id) => this.savePlayer(id));
    this.db.close();
  }

  private removePlayer(id: string): void {
    const p = this.state.players.get(id);
    if (p) {
      if (p.mode === 'car') {
        const car = this.state.cars.get(p.carId);
        if (car) {
          car.driverId = '';
          car.speed = 0;
        }
      }
      this.savePlayer(id);
      this.state.players.delete(id);
    }
    this.runtimes.delete(id);
  }

  private savePlayer(id: string): void {
    const p = this.state.players.get(id);
    const rt = this.runtimes.get(id);
    if (!p || !rt) return;
    this.db.save({ name: p.name, cash: p.cash, safe: p.safe, apt: p.apt, kills: rt.kills, deaths: rt.deaths });
  }

  private handleInteract(client: Client): void {
    const p = this.state.players.get(client.sessionId);
    if (!p) return;
    if (p.mode === 'car') {
      if (!p.cargo && dist2(p.x, p.z, this.map.warehouse.x, this.map.warehouse.z) < DELIVERY_PICKUP_DIST * DELIVERY_PICKUP_DIST) {
        tryStartDelivery(this.state, client.sessionId, this.map, Date.now());
        return;
      }
      tryExitCar(this.state, client.sessionId);
      return;
    }
    if (p.mode !== 'foot') return;
    let nearApt: Apartment | null = null;
    this.state.apartments.forEach((a) => {
      if (nearApt) return;
      if (dist2(p.x, p.z, a.doorX, a.doorZ) < DOOR_DIST * DOOR_DIST) nearApt = a;
    });
    if (nearApt) {
      const apt: Apartment = nearApt;
      if (apt.rentedBy === p.name) client.send('openSafe');
      else tryRent(this.state, this.runtimes, client.sessionId, Date.now());
      return;
    }
    tryEnterCar(this.state, client.sessionId);
  }

  private tick(dt: number): void {
    const now = Date.now();
    this.state.serverTime = now;
    tickMovement(this.state, this.runtimes, this.colliders, dt, now);
    tickVehicles(this.state, this.runtimes, this.carRuntime, this.colliders, dt, now, this.map.parkingSpots);
    tickRespawn(this.state, this.runtimes, this.map, now);
    tickPolice(this.state, this.runtimes, now, dt, this.map);
    tickDelivery(this.state, this.map, now);
    tickRent(this.state, this.runtimes, now);
    if (now - this.lastSaveAt > SAVE_INTERVAL_MS) {
      this.state.players.forEach((_p, id) => this.savePlayer(id));
      this.lastSaveAt = now;
    }
  }
}
