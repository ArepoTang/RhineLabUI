import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMotionPreferences, fullMotion, reducedMotion, motionPresetFor, motionSettingsMarkup } from '../src/motion-preferences.ts';

for (const system of [false, true]) {
  assert.equal(motionPresetFor(createMotionPreferences(undefined, system)), system ? 'reduced' : 'full');
  for (const legacy of [false, true]) {
    assert.equal(motionPresetFor(createMotionPreferences(undefined, legacy)), legacy ? 'reduced' : 'full');
  }
  assert.equal(motionPresetFor(createMotionPreferences(fullMotion(), system)), 'full');
  assert.equal(motionPresetFor(createMotionPreferences(reducedMotion(), system)), 'reduced');
  assert.equal(motionPresetFor(createMotionPreferences({ ...fullMotion(), boot: false }, system)), 'custom');
}
// Old saved scroll values must not change the preset or discard other choices.
for (const motion of [fullMotion(), reducedMotion(), { ...fullMotion(), modelDecryption: false }]) {
  for (const smoothScroll of [false, true]) {
    const restored = createMotionPreferences({ ...motion, smoothScroll }, undefined);
    assert.deepEqual(restored, motion);
    assert.equal(motionPresetFor(restored), motionPresetFor(motion));
    assert.ok(!motionSettingsMarkup(restored).includes('smoothScroll'));
    assert.equal(Object.keys(restored).length, 14);
  }
}
// 设置里的动效项只写名字：说明文字（含数据里的 description）全部删掉。
const markup = motionSettingsMarkup(fullMotion(), 'full');
assert.equal((markup.match(/<span>/g) ?? []).length, 0, '动效设置里不再有行内说明');
assert.ok(!markup.includes('完整或减少'), '表头不再解释预设');
assert.ok(!markup.includes('阵列 / 详情 / 界面'), '精细设置不再列内容');
assert.match(markup, /<label class="motion-setting"><div><strong>[A-Z ]+<\/strong><\/div>/, '每一项只有名字');
assert.ok(
  !readFileSync(new URL('../src/motion-preferences.ts', import.meta.url), 'utf8').includes('description'),
  '说明文字的数据字段也一并删掉',
);
console.log('Motion preferences: 12 initialization cases, 6 retired-scroll migration cases and the no-description-copy check passed.');
