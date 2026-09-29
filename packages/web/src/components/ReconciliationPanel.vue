<script setup lang="ts">
import type { Reconciliation } from '../types';

defineProps<{ data: Reconciliation | null }>();
</script>

<template>
  <section class="card">
    <h2>库存与结果核对（计划 / 预占 / 实际三方）</h2>
    <div v-if="!data" class="muted">加载中…</div>
    <template v-else>
      <div class="kpi-row">
        <div class="kpi">
          <span class="kpi-label">钞箱总价值</span>
          <span class="kpi-value">{{ data.totals.stockTotalValue }} 元</span>
          <small>{{ data.totals.stockTotalNotes }} 张</small>
        </div>
        <div class="kpi reserved-bg">
          <span class="kpi-label">在途预占</span>
          <span class="kpi-value">{{ data.totals.reservedValue }} 元</span>
          <small>{{ data.totals.reservedNotes }} 张</small>
        </div>
        <div class="kpi delivered-bg">
          <span class="kpi-label">实际已交付</span>
          <span class="kpi-value">{{ data.totals.deliveredValue }} 元</span>
          <small>{{ data.totals.deliveredNotes }} 张</small>
        </div>
        <div class="kpi rejected-bg">
          <span class="kpi-label">拒钞回收</span>
          <span class="kpi-value">{{ data.totals.rejectedValue }} 元</span>
          <small>{{ data.totals.rejectedNotes }} 张</small>
        </div>
        <div class="kpi">
          <span class="kpi-label">当前可用</span>
          <span class="kpi-value">{{ data.totals.availableValue }} 元</span>
          <small>{{ data.totals.availableNotes }} 张</small>
        </div>
      </div>

      <div
        class="invariant"
        :class="data.invariantCheck.ok ? 'ok-box' : 'fail-box'"
      >
        <strong v-if="data.invariantCheck.ok">
          ✓ 库存口径不变式成立：总张数 = 可用 + 预占 + 已出钞 + 拒钞；
          未结算预占汇总与钞箱 reserved 一致。
        </strong>
        <div v-else>
          <strong>✗ 发现核对差异：</strong>
          <ul>
            <li v-for="(v, i) in data.invariantCheck.violations" :key="i">
              {{ v }}
            </li>
          </ul>
        </div>
      </div>

      <div v-if="data.reservations.length" class="table-wrap">
        <table class="grid compact">
          <thead>
            <tr>
              <th>批次/预占</th>
              <th>#</th>
              <th>申请金额</th>
              <th>计划金额</th>
              <th>实际交付</th>
              <th>拒钞</th>
              <th>未完成(已释放)</th>
              <th>状态</th>
              <th>交付差异</th>
              <th>回报</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in data.reservations"
              :key="r.id"
              :class="{
                rowok: r.status === 'DISPENSED',
                rowpartial: r.status === 'PARTIAL',
                rowfail: r.status === 'FAILED',
                rowreserved: r.status === 'RESERVED',
              }"
            >
              <td>批#{{ r.batchId }} / 预占#{{ r.id }}</td>
              <td>{{ r.seq + 1 }}</td>
              <td>{{ r.requestedAmount }}</td>
              <td>{{ r.planAmount }}</td>
              <td class="strong">{{ r.deliveredAmount }}</td>
              <td>{{ r.rejectedAmount }}</td>
              <td>{{ r.unfinishedAmount }}</td>
              <td>
                <span
                  class="tag"
                  :class="{
                    ok: r.status === 'DISPENSED',
                    partial: r.status === 'PARTIAL',
                    fail: r.status === 'FAILED',
                    reserved: r.status === 'RESERVED',
                  }"
                  >{{ r.status }}</span
                >
              </td>
              <td>
                <span v-if="r.deliveredAmount === r.planAmount" class="muted">一致</span>
                <span v-else class="warn-text"
                  >差 {{ r.planAmount - r.deliveredAmount }} 元</span
                >
              </td>
              <td><small>{{ r.note || '已预占，等待模拟出钞回报' }}</small></td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="muted">尚无预占记录。</p>
    </template>
  </section>
</template>
