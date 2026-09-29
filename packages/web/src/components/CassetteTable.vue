<script setup lang="ts">
import { computed } from 'vue';
import type { Cassette } from '../types';

const props = defineProps<{
  cassettes: Cassette[];
  availableValue: number;
}>();

const denomClass = (d: number): string =>
  d >= 50 ? 'big' : d >= 10 ? 'mid' : 'small';
</script>

<template>
  <section class="card">
    <h2>钞箱库存（PostgreSQL 实时）</h2>
    <div class="table-wrap">
      <table class="grid">
        <thead>
          <tr>
            <th>面额</th>
            <th>总张数</th>
            <th>可用</th>
            <th>已预占</th>
            <th>已出钞(累计)</th>
            <th>拒钞回收(累计)</th>
            <th>可用价值</th>
            <th>占用示意</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in props.cassettes" :key="c.id">
            <td>
              <span class="denom" :class="denomClass(c.denomination)"
                >{{ c.denomination }} 元</span
              >
            </td>
            <td>{{ c.stockTotal }}</td>
            <td class="strong">{{ c.stockAvailable }}</td>
            <td>
              <span v-if="c.stockReserved > 0" class="tag reserved">{{
                c.stockReserved
              }}</span>
              <span v-else>0</span>
            </td>
            <td>{{ c.stockDelivered }}</td>
            <td>
              <span v-if="c.stockRejected > 0" class="tag rejected">{{
                c.stockRejected
              }}</span>
              <span v-else>0</span>
            </td>
            <td>{{ c.stockAvailable * c.denomination }} 元</td>
            <td>
              <div class="bar">
                <div
                  class="bar-avail"
                  :style="{
                    width:
                      (c.stockTotal
                        ? (c.stockAvailable / c.stockTotal) * 100
                        : 0) + '%',
                  }"
                ></div>
                <div
                  class="bar-res"
                  :style="{
                    width:
                      (c.stockTotal
                        ? (c.stockReserved / c.stockTotal) * 100
                        : 0) + '%',
                  }"
                ></div>
                <div
                  class="bar-del"
                  :style="{
                    width:
                      (c.stockTotal
                        ? (c.stockDelivered / c.stockTotal) * 100
                        : 0) + '%',
                  }"
                ></div>
                <div
                  class="bar-rej"
                  :style="{
                    width:
                      (c.stockTotal
                        ? (c.stockRejected / c.stockTotal) * 100
                        : 0) + '%',
                  }"
                ></div>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="hint">
      口径：可用 = 总张数 − 预占 − 已出钞 − 拒钞回收；当前可用总价值
      <strong>{{ props.availableValue }} 元</strong>。
      <span class="legend">
        <i class="sw avail"></i>可用
        <i class="sw res"></i>预占
        <i class="sw del"></i>已出钞
        <i class="sw rej"></i>拒钞
      </span>
    </p>
  </section>
</template>
