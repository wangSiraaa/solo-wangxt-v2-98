<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from './api';
import type { Cassette, Reconciliation } from './types';
import CassetteTable from './components/CassetteTable.vue';
import SingleEvaluate from './components/SingleEvaluate.vue';
import BatchFlow from './components/BatchFlow.vue';
import ReconciliationPanel from './components/ReconciliationPanel.vue';

const cassettes = ref<Cassette[]>([]);
const reconciliation = ref<Reconciliation | null>(null);
const loading = ref(false);
const error = ref('');
const activeTab = ref<'single' | 'batch'>('single');

const availableValue = computed(() =>
  cassettes.value.reduce(
    (s, c) => s + c.stockAvailable * c.denomination,
    0,
  ),
);

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [cs, rec] = await Promise.all([
      api.cassettes(),
      api.reconciliation(),
    ]);
    cassettes.value = cs;
    reconciliation.value = rec;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}

async function resetDemo(): Promise<void> {
  if (!window.confirm('确定清空全部批次/预占并把钞箱重置为种子数据？')) return;
  await api.reset();
  await refresh();
}

onMounted(refresh);
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div>
        <h1>现金配钞模拟中心</h1>
        <p class="subtitle">
          Vue 3 面额库存 / 组合解释 · NestJS 有界整数配钞 · PostgreSQL
          钞箱·预占·出钞回报（模拟，不连接真实 ATM）
        </p>
      </div>
      <div class="actions">
        <button class="btn ghost" :disabled="loading" @click="refresh">
          刷新库存/核对
        </button>
        <button class="btn warn" @click="resetDemo">重置演示数据</button>
      </div>
    </header>

    <div v-if="error" class="error-banner">接口错误：{{ error }}</div>

    <div class="notice">
      <strong>口径提醒：</strong
      >“计划可行 / 预占成功 / HTTP 请求成功”都不等于现金已交付。只有结算状态为
      <span class="tag ok">DISPENSED</span> 或
      <span class="tag partial">PARTIAL</span>
      时，“实际交付”列的金额才是客户拿到的现金；拒钞进入回收箱，未完成数量释放回可用库存。
    </div>

    <CassetteTable :cassettes="cassettes" :available-value="availableValue" />

    <nav class="tabs">
      <button
        class="tab"
        :class="{ active: activeTab === 'single' }"
        @click="activeTab = 'single'"
      >
        单笔试算
      </button>
      <button
        class="tab"
        :class="{ active: activeTab === 'batch' }"
        @click="activeTab = 'batch'"
      >
        批次：计划 → 事务预占 → 模拟出钞
      </button>
    </nav>

    <SingleEvaluate
      v-if="activeTab === 'single'"
      :cassettes="cassettes"
      @changed="refresh"
    />
    <BatchFlow
      v-else
      :cassettes="cassettes"
      @changed="refresh"
    />

    <ReconciliationPanel :data="reconciliation" />

    <footer class="footer">
      有界整数 DP：分层封顶可行解计数 + 对角线滑动窗口 O(n·A·L)；预占整批单事务、行锁防并发扣穿。
    </footer>
  </div>
</template>
