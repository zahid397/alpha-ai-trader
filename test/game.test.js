// Crimson Arena: runs the real, committed WebAssembly build of the C# engine
// (public/game/engine) under Node, drives it through the same decoder and
// attract-mode bot the browser uses, and checks the sprite manifest.
// The C# unit tests live in game/Engine.Tests (`npm run game:test`).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../public/game/', import.meta.url));
const { createDecoder } = await import(pathToFileURL(`${root}js/engine.js`).href);
const { Bot } = await import(pathToFileURL(`${root}js/bot.js`).href);

let api;
let layout;
let decode;

before(async () => {
  const { dotnet } = await import(pathToFileURL(`${root}engine/_framework/dotnet.js`).href);
  const runtime = await dotnet.create();
  const exports = await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName);
  api = exports.CrimsonArena.Web.GameExports;
  layout = JSON.parse(api.Layout());
  decode = createDecoder(layout);
});

describe('C# engine (WebAssembly build)', () => {
  test('publishes its frame layout and game data', () => {
    assert.equal(layout.version, 2);
    for (const key of ['header', 'player', 'enemy', 'projectile', 'trap', 'pickup', 'event']) assert.ok(layout[key].length > 0, key);
    assert.equal(layout.tuning.arenaWidth, 2400);
    assert.equal(layout.buttons.Attack, 16);
    assert.ok(layout.attacks[layout.attackKinds.Heavy].windup > 0);
  });

  test('starts a run on wave 1 with the player centred and traps armed', () => {
    api.Start(7);
    const s = decode(api.Step(0, 0));
    assert.equal(s.state, layout.states.Playing);
    assert.equal(s.wave, 1);
    assert.equal(s.player.hp, s.player.maxHp);
    assert.equal(s.traps.length, 3);
    assert.ok(s.events.some((e) => e.name === 'WaveStart'));
  });

  test('moves the player with the button bitmask', () => {
    api.Start(7);
    const start = decode(api.Step(0, 0)).player.x;
    let s;
    for (let i = 0; i < 60; i++) s = decode(api.Step(1 / 60, layout.buttons.Right | layout.buttons.Run));
    assert.ok(s.player.x - start > 250, `moved ${s.player.x - start}`);
    assert.equal(s.player.facing, 1);
  });

  test('replays identically from the same seed and inputs', () => {
    const run = () => {
      api.Start(99);
      const frames = [];
      for (let i = 0; i < 1800; i++) {
        const buf = api.Step(1 / 60, (i * 37) % 512);
        if (i % 60 === 0) frames.push(Array.from(buf).join(','));
      }
      return frames;
    };
    assert.deepEqual(run(), run());
  });

  test('summons the Main Boss on demand (the app unlock) exactly once', () => {
    const R = layout.summonResults;
    api.Start(31);
    assert.equal(api.SummonBoss(), R.Summoned);
    assert.equal(api.SummonBoss(), R.AlreadyHere);
    const s = decode(api.Step(1 / 60, 0));
    const boss = s.enemies.find((e) => e.kind === layout.enemyKinds.Warlord);
    assert.ok(boss, 'warlord spawned');
    assert.ok(Math.abs(boss.x - s.player.x) >= 260, 'spawns away from the player');
    assert.equal(s.bossKind, layout.enemyKinds.Warlord);
    assert.ok(s.events.some((e) => e.name === 'BossSpawn' && e.value === layout.enemyKinds.Warlord));
  });

  test('a bot can fight through waves while every frame stays sane', () => {
    api.Start(2024);
    const bot = new Bot(layout);
    let s = decode(api.Step(0, 0));
    let kills = 0;
    const seen = new Set();
    for (let i = 0; i < 60 * 90 && s.state !== layout.states.GameOver; i++) {
      s = decode(api.Step(1 / 60, bot.buttons(s)));
      for (const e of s.events) seen.add(e.name);
      kills = s.kills;
      const p = s.player;
      assert.ok(p.x >= 40 && p.x <= 2360, `player x ${p.x}`);
      assert.ok(p.hp >= 0 && p.hp <= p.maxHp);
      for (const e of s.enemies) assert.ok(Number.isFinite(e.x) && Number.isFinite(e.hp));
    }
    assert.ok(kills >= 3, `bot kills ${kills}`);
    for (const name of ['Hit', 'Swing', 'EnemyDeath', 'TrapFire', 'Spawn']) assert.ok(seen.has(name), `saw ${name}`);
  });
});

describe('sprite manifest', () => {
  const manifest = JSON.parse(readFileSync(`${root}assets/sprites.json`, 'utf8'));

  test('every animation references real frames with sane anchors', () => {
    for (const [name, sheet] of Object.entries(manifest.sheets)) {
      assert.ok(existsSync(`${root}${sheet.image}`), `${name} atlas exists`);
      for (const f of sheet.frames) {
        assert.ok(f.w > 0 && f.h > 0, `${name} frame size`);
        assert.ok(f.ax >= 0 && f.ax <= f.w && f.ay >= 0 && f.ay <= f.h + 1, `${name} anchor inside frame`);
      }
      for (const [anim, frames] of Object.entries(sheet.animations)) {
        assert.ok(frames.length > 0, `${name}.${anim} has frames`);
        for (const i of frames) assert.ok(sheet.frames[i], `${name}.${anim} frame ${i}`);
      }
    }
  });

  test('has every animation the renderer uses', () => {
    const need = {
      heroine: ['idle', 'walk', 'run', 'jump', 'fall', 'attack1', 'attack2', 'heavy', 'hurt', 'death'],
      knight: ['idle', 'slash', 'overhead', 'lunge'],
      warlord: ['idle', 'walk', 'heavy', 'death'],
      rogue: ['idle', 'walk', 'run', 'throw', 'recover'],
      trap: ['idle', 'charge', 'rise', 'full', 'retract'],
      fx: ['crescent']
    };
    for (const [sheet, anims] of Object.entries(need)) {
      for (const a of anims) assert.ok(manifest.sheets[sheet]?.animations[a], `${sheet}.${a}`);
    }
    assert.ok(manifest.sheets.rogue.animations.throw.length >= 5);
  });
});
