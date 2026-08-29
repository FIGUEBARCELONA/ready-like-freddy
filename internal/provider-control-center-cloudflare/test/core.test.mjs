import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDomain, laneFor, indicators, checkRobots, stripHtml } from '../src/worker.js';

test('normalitza dominis i lanes de manera determinista',()=>{
  assert.equal(normalizeDomain('https://www.Example.com/a'),'example.com');
  assert.equal(laneFor('abc'),laneFor('abc'));
  assert.ok(laneFor('abc')>=1&&laneFor('abc')<=50);
});

test('detecta senyals sense promoció automàtica',()=>{
  const f=indicators('Vintage second hand shop. Add to cart. Legal notice. Fred Perry.');
  assert.deepEqual(f,{secondhand:true,commerce:true,legal:true,fred_perry:true});
});

test('respecta robots disallow root',()=>{
  assert.equal(checkRobots('User-agent: *\nDisallow: /','RLFProviderVerifier'),false);
  assert.equal(checkRobots('User-agent: *\nDisallow: /private','RLFProviderVerifier'),true);
});

test('neteja HTML',()=>{
  assert.equal(stripHtml('<style>x</style><h1> Hola </h1><script>x</script>'),'Hola');
});
