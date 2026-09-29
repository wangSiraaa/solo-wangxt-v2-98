<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  api,
  type Cassette,
  type CashRequestView,
  type ReconcileReport,
} from './api';
import CassettePanel from './components/CassettePanel.vue';
import PlanForm from './components/PlanForm.vue';
import RequestList from './components/RequestList.vue';
import ReconcilePanel from './components/ReconcilePanel.vue';

const cassettes = ref<Cassette[]>([]);
const requests = ref<CashRequestView[]>([]);
const report = ref<ReconcileReport | null>(null);
const busy = ref(false);
const notice = ref<{ kind: 'ok' | 'err'; text: string } | null>(null);

function flash(kind: 'ok' | 'err', text: string) {
  notice.value = { kind, text };
}

async function refreshAll() {
  [cassettes.value, requests.value, report.value] = await Promise.all([
    api.cassettes(),
    api.requests(),
    api.reconcile(),
  ]);
}

async function onPlan(
  payload: {
    clientRef: string;
    amountCents: number;
    allowedDenominations: number[];
    maxNotes: number;
  }[],
) {
  busy.value = true;
  notice.value = null;
  try {
    const res = await api.planBatch(payload);
    requests.value = res.requests;
    cassettes.value = await api.cassettes();
    report.value = await api.reconcile();
    const bad = res.requests.filter((r) => r.planStatus === 'infeasible').length;
    flash(
      bad > 0 ? 'err' : 'ok',
      `计划完成：${res.requests.length - bad} 笔可行，${bad} 笔不可行（计划未扣减任何库存）`,
    );
  } catch (e) {
    flash('err', '生成计划失败：' + (e as Error).message);
  } finally {
    busy.value = false;
  }
}

async function onReserve(payload: { ids: string[]; allOrNothing: boolean }) {
  busy.value = true;
  notice.value = null;
  try {
    const res = await api.reserveBatch(payload.ids, { allOrNothing: payload.allOrNothing });
    await refreshAll();
    if (payload.allOrNothing && res.reserved.length === 0 && payload.ids.length > 0) {
      // 整批回滚会以 409 抛出，走 catch；能到这里说明全部成功
    }
    const parts = [`已预占 ${res.reserved.length} 笔`];
    if (res.failed.length > 0) {
      parts.push(`跳过 ${res.failed.length} 笔：` + res.failed.map((f) => f.reason).join('；'));
    }
    parts.push('（预占只是冻结库存，现金尚未交付）');
    flash(res.failed.length > 0 ? 'err' : 'ok', parts.join('。'));
  } catch (e) {
    await refreshAll();
    flash('err', '整批预占已事务回滚：' + (e as Error).message);
  } finally {
    busy.value = false;
  }
}

async function onDispense(payload: {
  id: string;
  outcome: 'success' | 'reject' | 'partial';
  delivered?: Record<string, number>;
}) {
  busy.value = true;
  notice.value = null;
  try {
    await api.dispense(payload.id, payload.outcome, payload.delivered);
    await refreshAll();
    const map = { success: '足额出钞成功', reject: '全部拒钞（库存已回补）', partial: '部分出钞（未完成部分已回补）' };
    flash('ok', `模拟器回报：${map[payload.outcome]}。请以“实际交付”金额为准。`);
  } catch (e) {
    flash('err', '出钞操作失败：' + (e as Error).message);
  } finally {
    busy.value = false;
  }
}

async function onReset() {
  busy.value = true;
  try {
    const res = await api.reset();
    cassettes.value = res.cassettes;
    requests.value = await api.requests();
    report.value = await api.reconcile();
    flash('ok', '钞箱、计划与审计已全部重置为默认配钞');
  } catch (e) {
    flash('err', '重置失败：' + (e as Error).message);
  } finally {
    busy.value = false;
  }
}

async function reconcileNow() {
  busy.value = true;
  try {
    report.value = await api.reconcile();
  } catch (e) {
    flash('err', '核对失败：' + (e as Error).message);
  } finally {
    busy.value = false;
  }
}

onMounted(refreshAll);
</script>

<template>
  <div>
    <h1>现金服务中心 · 有限钞箱配钞模拟器</h1>
    <div class="subtitle">
      Vue 3 展示面额库存与组合解释 · NestJS 有界整数规划 · PostgreSQL 事务预占与出钞回报。
      流程：<strong>计划 → 事务预占 → 模拟器出钞 → 账实核对</strong>。
      请求成功/预占成功都不代表现金已交付，只有“实际交付”金额算数。
    </div>

    <div class="grid">
      <CassettePanel :cassettes="cassettes" :busy="busy" @reset="onReset" />
      <ReconcilePanel :report="report" />
    </div>

    <div class="section-gap">
      <PlanForm :busy="busy" @plan="onPlan" />
    </div>

    <div v-if="notice" class="section-gap">
      <div :class="notice.kind === 'ok' ? 'ok-box' : 'error-box'">{{ notice.text }}</div>
    </div>

    <div class="section-gap">
      <RequestList
        :requests="requests"
        :busy="busy"
        @reserve="onReserve"
        @dispense="onDispense"
      />
    </div>

    <div class="section-gap row" style="justify-content: flex-end">
      <button class="secondary" :disabled="busy" @click="reconcileNow">立即核对库存与结果</button>
    </div>
  </div>
</template>
