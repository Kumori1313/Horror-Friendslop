import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchor } from '../src/layout.ts';
import { assignment, catalog, flareTime, items, prices, wallet } from '../src/mission.ts';
import { home, placeOf } from '../src/places.ts';
import { batteryLife, chargeOf, slotsOf, type Player } from '../src/room.ts';
import { generateLayout } from '../src/server/generate-layout.ts';
import { Simulation } from '../src/server/simulation.ts';
import { escape, goInside, goOutside, ring } from './travel.ts';

// A crew between expeditions, at home with `funds` in the wallet, operator 1
// at the supply terminal.
function shopping(funds: number) {
  const sim = new Simulation(generateLayout(19),'coop','home');
  sim.join(); sim.join();
  const mission = () => sim.state.mission!;
  mission().contract.credited = funds;
  const player = (id: number) => sim.state.players.find(p => p.id === id)!;
  const t = home().terminal;
  const atTerminal = (id: number) => Object.assign(player(id),{x:t.x+1.2,z:t.z,feetY:0,place:'home'});
  atTerminal(1);
  const run = (seconds: number) => { for (let i=0;i<Math.round(seconds*30);i++) sim.tick(1/30); };
  const bought = () => mission().haul.filter(h => h.kind);
  return {sim,mission,player,atTerminal,run,bought};
}
const stand = (p: Player, at: {x: number; y?: number; z: number}) => Object.assign(p,{x:at.x,z:at.z,feetY:at.y ?? 0});

test('the supply terminal sells for the price from the wallet, not the quota, and lays the purchase out at home', () => {
  const {sim,mission,player,bought} = shopping(150);
  assert.equal(assignment(sim.layout!,sim.state,player(1),sim.solids(player(1)))?.kind,'shop');
  sim.act(1,'buy',{buy:'cell'});
  assert.equal(wallet(mission().contract),150-prices.cell);
  assert.equal(mission().contract.credited,150,'the quota still counts sales only');
  const [cell] = bought();
  assert.deepEqual([cell.kind,cell.owner,placeOf(cell)],['cell',null,'home']);
  assert.ok(Math.hypot(cell.x-home().terminal.x,cell.z-home().terminal.z) < 3,'in front of the terminal');
  sim.act(1,'buy',{buy:'baton'});
  assert.equal(wallet(mission().contract),10);
  assert.equal(bought().length,2);
  assert.ok(Math.hypot(bought()[0].x-bought()[1].x,bought()[0].z-bought()[1].z) >= 0.3,'laid side by side');
  sim.act(1,'buy',{buy:'flare'});
  assert.equal(bought().length,2,'not enough left for a flare');
  sim.act(1,'buy',{buy:'lamp'});
  assert.equal(wallet(mission().contract),10,'no replacement while the flashlight is at hand');
  // Away from the terminal, nothing sells.
  mission().contract.credited = 500;
  stand(player(1),{x:3,z:2});
  sim.act(1,'buy',{buy:'cell'});
  assert.equal(bought().length,2);
});

test('two operators buying at once with money for one get one, debited once', () => {
  const {sim,mission,atTerminal,bought} = shopping(prices.cell+10);
  atTerminal(2);
  sim.act(1,'buy',{buy:'cell'});
  sim.act(2,'buy',{buy:'cell'});
  assert.deepEqual([bought().length,wallet(mission().contract),mission().contract.spent],[1,10,prices.cell]);
  // A refresh restores the wallet and the purchase.
  const again = new Simulation(sim.layout,'coop','home'); again.join(); again.join();
  again.state = JSON.parse(JSON.stringify(sim.state));
  assert.equal(wallet(again.state.mission!.contract),10);
  assert.equal(again.state.mission!.haul.filter(h => h.kind).length,1);
});

test('bought gear comes home with whoever escapes; left behind, it and the flashlight are lost', () => {
  const {sim,mission,player,bought} = shopping(400);
  for (const ware of ['cell','flare','baton'] as const) sim.act(1,'buy',{buy:ware});
  const [cell,flare,baton] = bought().map(h => h.id);
  // Operator 1 takes the cell and the flashlight; operator 2 the baton. The
  // flare stays at home.
  stand(player(1),bought()[0]); sim.act(1,'take');
  stand(player(1),{...home().lamp}); sim.act(1,'take');
  stand(player(2),bought().find(h => h.id === baton)!); sim.act(2,'take');
  assert.deepEqual(slotsOf(player(1)).filter(Boolean).sort(),[cell,'lamp'].sort());
  assert.equal(mission().awake,undefined,'bought gear wakes nothing');
  goInside(sim);
  // Operator 1 leaves the flashlight inside and escapes with the cell; operator 2 stays out.
  sim.act(1,'select',{slot:slotsOf(player(1)).indexOf('lamp')});
  sim.act(1,'drop');
  ring(sim,1); escape(sim,1);
  assert.deepEqual(slotsOf(player(1)).filter(Boolean),[cell],'escaping keeps bought gear in hand');
  mission().rift!.seconds = 0.01;
  sim.tick(1/30);
  assert.equal(mission().stage,'settled');
  assert.equal(sim.state.lamp.lost,true,'the flashlight was left behind');
  sim.act(1,'next');
  assert.equal(mission().stage,'home');
  assert.deepEqual(bought().map(h => h.id).sort(),[cell,flare].sort(),'the baton was left behind with operator 2');
  assert.deepEqual(slotsOf(player(1)).filter(Boolean),[cell]);
  assert.equal(items(sim.layout!,mission()).some(i => i.id === flare && i.place === 'home'),true);
  // A lost flashlight can't be picked up, but the terminal sells another, full.
  stand(player(2),{...home().lamp}); sim.act(2,'take');
  assert.equal(sim.state.lamp.owner,null);
  const t = home().terminal;
  stand(player(1),{x:t.x+1.2,z:t.z});
  const before = wallet(mission().contract);
  sim.act(1,'buy',{buy:'lamp'});
  assert.deepEqual([sim.state.lamp.lost,chargeOf(sim.state.lamp),placeOf(sim.state.lamp),wallet(mission().contract)],[false,batteryLife,'home',before-prices.lamp]);
});

test('a wipe starts the fresh contract with an empty wallet, no gear, and a new flashlight', () => {
  const {sim,mission} = shopping(200);
  sim.act(1,'buy',{buy:'cell'});
  goInside(sim);
  mission().escaped = [];
  for (const p of sim.state.players) mission().down.push({id:p.id,seconds:75});
  sim.tick(1/30);
  assert.deepEqual([mission().stage,mission().outcome],['settled','wipe']);
  sim.act(1,'next');
  assert.deepEqual([wallet(mission().contract),mission().haul.length,sim.state.lamp.lost,chargeOf(sim.state.lamp)],[0,0,false,batteryLife]);
});

test('a flare lights when thrown or dropped, burns for a minute wherever it is, then is gone', () => {
  const {sim,mission,player,run,bought} = shopping(100);
  sim.act(1,'buy',{buy:'flare'}); sim.act(1,'buy',{buy:'flare'});
  const [a,b] = bought().map(h => h.id);
  stand(player(1),bought()[0]); sim.act(1,'take');
  stand(player(1),bought().find(h => h.id === b)!); sim.act(1,'take');
  assert.equal(bought().every(h => h.burn === undefined),true,'unlit in hand');
  sim.act(1,'select',{slot:slotsOf(player(1)).indexOf(a)});
  sim.act(1,'drop');
  sim.act(1,'select',{slot:slotsOf(player(1)).indexOf(b)});
  sim.act(1,'throw',{aim:{yaw:0,pitch:0.3,power:0.4}});
  assert.equal(bought().every(h => h.burn === flareTime),true,'both lit');
  // Picked up again, a lit flare keeps burning in hand.
  run(1);
  stand(player(2),bought().find(h => h.id === a)!); sim.act(2,'take');
  run(flareTime-2);
  assert.equal(bought().find(h => h.id === a)!.owner,2,'still burning in hand');
  run(1.5);
  assert.equal(items(sim.layout!,mission()).some(i => i.id === a || i.id === b),false,'burnt out');
  assert.deepEqual(slotsOf(player(2)).filter(Boolean),[]);
});

test('bought gear thrown into the exit rift turns up at home instead of being sold', () => {
  const {sim,mission,player,bought} = shopping(100);
  sim.act(1,'buy',{buy:'cell'});
  stand(player(1),bought()[0]); sim.act(1,'take');
  goInside(sim);
  ring(sim,2);
  const rift = mission().rift!;
  goOutside(sim,1);
  stand(player(1),{x:rift.x,z:rift.z+1.6});
  sim.act(1,'throw',{aim:{yaw:0,pitch:0.2,power:0.25}});
  const cell = bought()[0];
  assert.equal(cell.banked,undefined,'not banked');
  for (let t=0;t<3;t+=1/30) sim.tick(1/30);
  assert.equal(placeOf(bought()[0]),'home');
  assert.equal(catalog(sim.layout!,mission()).find(i => i.id === cell.id)?.kind,'cell');
});

test('the stun baton stuns the Bell Diver only when its bell is within reach ahead', () => {
  const sim = new Simulation(generateLayout(19),'coop','inside');
  sim.join(); sim.join();
  const mission = sim.state.mission!, layout = sim.layout!;
  mission.haul.push({id:'bought-1',kind:'baton',owner:null,x:0,y:0,z:0,place:'inside'});
  const p1 = sim.state.players[0], p2 = sim.state.players[1];
  stand(p1,{x:0,z:0}); sim.act(1,'take');
  sim.act(1,'select',{slot:slotsOf(p1).indexOf('bought-1')});
  const hall = layout.rooms.find(r => r.template === 'hall') ?? layout.rooms.find(r => r.kind !== 'corridor' && r.kind !== 'intake')!;
  const a = anchor(hall), intake = anchor(layout.rooms.find(r => r.id === 'intake')!);
  stand(p2,intake);
  mission.awake = true;
  const hang = (mode: 'hanging' | 'strike') => { mission.diver = {mode,bay:hall.id,seconds:mode === 'strike' ? 1 : 99,x:a.x,y:a.y,z:a.z-1,moves:0}; };
  // Raised to the ceiling, it is out of reach.
  stand(p1,{x:a.x,y:a.y,z:a.z}); p1.yaw = 0;
  hang('hanging');
  sim.act(1,'swing');
  assert.equal(mission.diver.stun,undefined,'out of reach overhead');
  // On the floor in front, a swing stuns it.
  hang('strike');
  sim.tick(1);
  p1.yaw = 0;
  sim.act(1,'swing');
  assert.ok(mission.diver.stun !== undefined,'stunned');
  assert.equal(p1.swings,2);
  // Behind the swinger, or a second swing too soon, does nothing.
  hang('strike');
  sim.tick(1);
  p1.yaw = Math.PI;
  sim.act(1,'swing');
  assert.equal(mission.diver.stun,undefined,'behind');
  sim.act(1,'swing');
  assert.equal(p1.swings,3,'a second swing within a second is ignored');
});
