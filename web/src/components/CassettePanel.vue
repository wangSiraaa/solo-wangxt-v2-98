<script setup lang="ts">
import { computed } from 'vue';
import type { Cassette } from '../api';
import { yuan } from '../api';

const props = defineProps<{ cassettes: Cassette[]; busy?: boolean }>();
const emit = defineEmits<{ (e: 'reset'): void }>();

const totalValue = computed(() =>
  props.cassettes.reduce((s, c) => s + c.remainingValueCents, 0),
);
</script>

<template>
  <div class="panel">
    <div class="row" style="justify-content: space-between">
      <h2>钞箱库存（模拟，不接真实 ATM）</h2>
      <button class="secondary" :disabled="busy" @click="emit('reset')">重置为默认配钞</button>
    </div>
    <table>
      <thead>
        <tr>
          <th>面额</th>
          <th>初始</th>
          <th>现存</th>
          <th>已出</th>
          <th style="width: 30%">存量</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="c in cassettes" :key="c.denomination">
          <td>{{ yuan(c.denomination) }}</td>
          <td>{{ c.initialCount }}</td>
          <td><strong>{{ c.remainingCount }}</strong></td>
          <td>{{ c.deliveredCount }}</td>
          <td>
            <div class="stock-bar">
              <div
                :style="{
                  width:
                    c.initialCount > 0
                      ? (c.remainingCount / c.initialCount) * 100 + '%'
                      : '0%',
                  background:
                    c.remainingCount / Math.max(1, c.initialCount) < 0.25
                      ? 'var(--red)'
                      : undefined,
                }"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p class="muted" style="margin-top: 8px">
      当前现存总金额：<strong>{{ yuan(totalValue) }}</strong
      >。默认配钞里小面额偏紧（¥1 仅 8 张、¥2 仅 12 张）。
    </p>
  </div>
</template>
