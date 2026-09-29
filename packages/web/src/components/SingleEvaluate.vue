<script setup lang="ts">
import { ref } from 'vue';
import type { Cassette, SolveResult, WithdrawRequest } from '../types';
import { api } from '../api';
import CombinationExplain from './CombinationExplain.vue';

const props = defineProps<{ cassettes: Cassette[] }>();
const emit = defineEmits<{ (e: 'changed'): void }>();

const amount = ref(100);
const maxNotes = ref(50);
const allowed = ref<number[]>([]);
const result = ref<SolveResult | null>(null);
const busy = ref(false);
const err = ref('');

function toggle(d: number): void {
  const i = allowed.value.indexOf(d);
  if (i >= 0) allowed.value.splice(i, 1);
  else allowed.value.push(d);
}

async function evaluate(): Promise<void> {
  busy.value = true;
  err.value = '';
  try {
    const req: WithdrawRequest = {
      amount: Math.trunc(amount.value),
      maxNotes: Math.trunc(maxNotes.value),
      allowedDenominations:
        allowed.value.length > 0 ? [...allowed.value].sort((a, b) => a - b) : undefined,
    };
    result.value = await api.evaluate(req);
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

function fillScenario(kind: 'short' | 'multi' | 'notelimit'): void {
  allowed.value = [];
  if (kind === 'short') {
    amount.value = 104;
    maxNotes.value = 50;
  } else if (kind === 'multi') {
    amount.value = 100;
    maxNotes.value = 50;
  } else {
    amount.value = 160;
    maxNotes.value = 3;
  }
}
</script>

<template>
  <section class="card">
    <h2>单笔试算（不预占、不写库）</h2>
    <div class="form-grid">
      <label>
        取款金额（元，正整数）
        <input v-model.number="amount" type="number" min="1" step="1" />
      </label>
      <label>
        单笔张数上限（张）
        <input v-model.number="maxNotes" type="number" min="1" step="1" />
      </label>
      <div class="denom-picker">
        <span class="picker-label">允许面额（不勾=全部）：</span>
        <button
          v-for="c in props.cassettes"
          :key="c.id"
          type="button"
          class="denom-toggle"
          :class="{
            on: allowed.includes(c.denomination),
            empty: c.stockAvailable === 0,
          }"
          @click="toggle(c.denomination)"
        >
          {{ c.denomination }}元
          <small>余{{ c.stockAvailable }}</small>
        </button>
      </div>
      <div class="form-actions">
        <button class="btn primary" :disabled="busy" @click="evaluate">
          {{ busy ? '计算中…' : '求可行组合' }}
        </button>
        <button class="btn ghost" @click="fillScenario('short')">
          样例：小面额不足(104)
        </button>
        <button class="btn ghost" @click="fillScenario('multi')">
          样例：多组合(100)
        </button>
        <button class="btn ghost" @click="fillScenario('notelimit')">
          样例：张数上限(160/3张)
        </button>
      </div>
    </div>
    <div v-if="err" class="error-text">{{ err }}</div>
    <CombinationExplain :result="result" />
  </section>
</template>
