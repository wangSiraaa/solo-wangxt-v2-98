<script setup lang="ts">
import type { ReconcileReport } from '../api';
import { yuan } from '../api';

defineProps<{ report: ReconcileReport | null }>();
</script>

<template>
  <div class="panel">
    <h2>库存与结果核对</h2>
    <div v-if="!report" class="muted">点击“立即核对”生成账实核对报告。</div>
    <template v-else>
      <div class="row" style="margin-bottom: 10px">
        <span
          class="tag"
          :class="report.allPass ? 'dispensed' : 'failed'"
          style="font-size: 13px"
        >
          {{ report.allPass ? '全部核对通过' : '存在核对差异' }}
        </span>
      </div>
      <div class="grid" style="grid-template-columns: repeat(4, 1fr); gap: 8px">
        <div class="kpi">
          <div class="v">{{ yuan(report.summary.initialValueCents) }}</div>
          <div class="l">初始价值</div>
        </div>
        <div class="kpi">
          <div class="v">{{ yuan(report.summary.remainingValueCents) }}</div>
          <div class="l">现存</div>
        </div>
        <div class="kpi">
          <div class="v" style="color: var(--amber)">
            {{ yuan(report.summary.heldValueCents) }}
          </div>
          <div class="l">预占未出</div>
        </div>
        <div class="kpi">
          <div class="v" style="color: var(--green)">
            {{ yuan(report.summary.deliveredValueCents) }}
          </div>
          <div class="l">实际已出</div>
        </div>
      </div>
      <table style="margin-top: 12px">
        <tbody>
          <tr v-for="c in report.checks" :key="c.name">
            <td style="width: 24px" :class="c.pass ? 'check-pass' : 'check-fail'">
              {{ c.pass ? '✓' : '✗' }}
            </td>
            <td>{{ c.name}}</td>
            <td class="muted">{{ c.detail }}</td>
          </tr>
        </tbody>
      </table>
    </template>
  </div>
</template>
