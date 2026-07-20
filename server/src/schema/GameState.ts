import { Schema, MapSchema, type, view } from '@colyseus/schema';
import { MAX_HP } from '@mmo/shared';

export class Player extends Schema {
  @type('string') name = '';
  @type('string') role: 'citizen' | 'cop' | 'zombie' = 'citizen';
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') z = 0;
  @type('number') rotY = 0;
  @type('number') hp = MAX_HP;
  @type('string') mode: 'foot' | 'car' | 'jail' | 'dead' = 'foot';
  @type('string') carId = '';
  @type('string') apt = '';
  @type('number') wantedUntil = 0; // публично: коп видит красный маркер над розыскным
  @view() @type('number') jailUntil = 0;
  @view() @type('number') cash = 0;
  @view() @type('number') safe = 0;
  @view() @type('boolean') cargo = false;
  @view() @type('string') deliveryTarget = '';
  @view() @type('number') deliveryDeadline = 0;
  @type('string') weapon = ''; // публично: другие рисуют оружие в руке; '' = кулаки
  @view() @type('number') ammo = 0;
}

export class Car extends Schema {
  @type('string') id = '';
  @type('number') x = 0;
  @type('number') z = 0;
  @type('number') rotY = 0;
  @type('number') speed = 0;
  @type('number') steer = 0;
  @type('string') driverId = '';
}

export class Apartment extends Schema {
  @type('string') id = '';
  @type('number') doorX = 0;
  @type('number') doorZ = 0;
  @type('string') rentedBy = '';
}

export class Pickup extends Schema {
  @type('string') id = '';
  @type('string') kind = '';
  @type('number') x = 0;
  @type('number') z = 0;
  @type('boolean') active = true;
  @type('number') amount = 0; // только kind='cash'
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: Car }) cars = new MapSchema<Car>();
  @type({ map: Apartment }) apartments = new MapSchema<Apartment>();
  @type({ map: Pickup }) pickups = new MapSchema<Pickup>();
  @type('number') serverTime = 0;
}
