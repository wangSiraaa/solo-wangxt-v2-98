<script setup lang="ts">
import { computed, ref } from 'vue';
import type {
  Cassette,
  DispenseResponse,
  PlanBatch,
  ReserveOutcome,
} from '../types';
import { api } from '../api';

const props = defineProps<{ cassettes: Cassette[] }>();
const emits = defineEmits<{ (e: 'changed'): void }>();

interface BatchRow {
  amount: number;
  maxNotes: number;
  allowedText: string; // 逗号分隔，空=全部
}

const defaultRows = (): BatchRow[] => [
  { amount: 380, maxNotes: 50, allowedText: '' },
  { amount: 260, maxNotes: 50, allowedText: '100,50,20,10,5,1' },
  { amount: 100, maxNotes: 50, allowedText: '' },
];

const rows = ref<BatchRow[]>(defaultRows());
const plan = ref<PlanBatch | null>(null);
const reserve = ref<ReserveOutcome | null>(null);
const dispense = ref<DispenseResponse | null>(null);
const phase = ref<'idle' | 'planned' | 'reserved' | 'settled'>('idle');
const busy = ref(false);
const err = ref('');

const rejectRate = ref(0.1);
const shortageRatio = ref(0.25);

function parseAllowed(text: string): number[] | undefined {
  const t = text.trim();
  if (!t) return undefined;
  return t
    .split(/[,，\s]+/)
    .filter(Boolean)
    .map((s) => Number(s));
}

function buildRequests() {
  return rows.value.map((r) => ({
    amount: Math.trunc(r.amount),
    maxNotes: Math.trunc(r.maxNotes),
    allowedDenominations: parseAllowed(r.allowedText),
  }));
}

function addRow(): void {
  rows.value.push({ amount: 200, maxNotes: 50, allowedText: '' });
}
function removeRow(i: number): void {
  rows.value.splice(i, 1);
}

function fillScenario(kind: 'shortage' | 'multi' | 'oversell'): void {
  if (kind === 'shortage') {
    rows.value = [
      { amount: 300, maxNotes: 50, allowedText: '' },
      { amount: 99, maxNotes: 50, allowedText: '' },
      { amount: 104, maxNotes: 50, allowedText: '' },
    ];
  } else if (kind === 'multi') {
    rows.value = [
      { amount: 100, maxNotes: 50, allowedText: '' },
      { amount: 200, maxNotes: 50, allowedText: '100,50,20' },
      { amount: 50, maxNotes: 50, allowedText: '' },
    ];
  } else {
    // 超过 100 元钞箱价值（4000）的申请，整批回滚演示
    rows.value = [
      { amount: 300, maxNotes: 50, allowedText: '' },
      { amount: 4100, maxNotes: 50, allowedText: '100' },
    ];
  }
  resetPhases();
}

function resetPhases(): void {
  plan.value = null;
  reserve.value = null;
  dispense.value = null;
  phase.value = 'idle';
  err.value = '';
}

async function doPlan(): Promise<void> {
  resetPhases();
  busy.value = true;
  try {
    plan.value = await api.plan(buildRequests());
    phase.value = 'planned';
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function doReserve(): Promise<void> {
  busy.value = true;
  err.value = '';
  try {
    reserve.value = await api.reserve(buildRequests());
    if (reserve.value.status === 'RESERVED') {
      phase.value = 'reserved';
      dispense.value = null;
    } else {
      // 整批回滚：停在计划阶段，醒目展示失败原因
      phase.value = 'planned';
    }
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

async function doDispense(
  mode: 'simulate' | 'success' | 'reject' | 'shortage',
): Promise<void> {
  if (!reserve.value?.batchId) return;
  busy.value = true;
  err.value = '';
  try {
    dispense.value = await api.dispense(reserve.value.batchId, {
      mode,
      rejectRate: rejectRate.value,
      shortageRatio: shortageRatio.value,
    });
    phase.value = 'settled';
    emits.changed();
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}

const phaseLabel = computed(() => {
  switch (phase.value) {
    case 'planned':
      return '① 已生成计划（尚未占用任何库存）';
    case 'reserved':
      return '② 已在数据库事务内整批预占（现金尚未交付）';
    case 'settled':
      return '③ 出钞回报已结算（以实际交付为准）';
    default:
      return '填写/选择一批申请';
  }
});

function countsText(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([d, q]) => `${d}元×${q}`)
    .join('，') || '—';
}
</script>

<template>
  <section class="card">
    <h2>批次流程：计划 → 事务预占 → 模拟出钞</h2>
    <p class="phase">{{ phaseLabel }}</p>

    <div class="batch-editor">
      <table class="grid compact">
        <thead>
          <tr>
            <th style="width: 40px">#</th>
            <th>取款金额(元)</th>
            <th>张数上限</th>
            <th>允许面额（逗号分隔，空=全部）</th>
            <th style="width: 60px"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="i">
            <td>{{ i + 1 }}</td>
            <td><input v-model.number="r.amount" type="number" min="1" /></td>
            <td><input v-model.number="r.maxNotes" type="number" min="1" /></td>
            <td><input v-model="r.allowedText" placeholder="如 100,50,20" /></td>
            <td>
              <button class="btn tiny warn" @click="removeRow(i)">删</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="form-actions wrap">
      <button class="btn ghost" @click="addRow">+ 增加一笔</button>
      <button class="btn ghost" @click="fillScenario('shortage')">
        样例：含小面额不足(99/104)
      </button>
      <button class="btn ghost" @click="fillScenario('multi')">
        样例：多组合批次
      </button>
      <button class="btn ghost" @click="fillScenario('oversell')">
        样例：库存不足整批回滚
      </button>
      <span class="spacer"></span>
      <button class="btn primary" :disabled="busy" @click="doPlan">
        ① 生成计划
      </button>
      <button
        class="btn primary"
        :disabled="busy || !plan || (plan && plan.feasibleCount !== plan.total)"
        @click="doReserve"
      >
        ② 整批事务预占
      </button>
    </div>
    <p v-if="plan && plan.feasibleCount !== plan.total" class="warn-text">
      批次中存在不可行申请（{{ plan.total - plan.feasibleCount }}
      笔），整批预占会回滚。请先调整或移除标红的申请。
    </p>
    <div v-if="err" class="error-text">{{ err }}</div>

    <!-- 阶段一：计划 -->
    <div v-if="plan" class="stage">
      <h3>① 计划（可行 {{ plan.feasibleCount }}/{{ plan.total }}，纯计算未落库）</h3>
      <div class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>#</th>
              <th>申请</th>
              <th>结论</th>
              <th>主组合（各面额占用数量）</th>
              <th>备选</th>
              <th>无解解释 / 缺少金额</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in plan.items"
              :key="item.seq"
              :class="{ rowfail: !item.result.feasible }"
            >
              <td>{{ item.seq + 1 }}</td>
              <td>
                {{ item.request.amount }}元 ·
                ≤{{ item.request.maxNotes }}张<template
                  v-if="item.request.allowedDenominations?.length"
                  ><br /><small
                    >仅 {{ item.request.allowedDenominations.join('/') }}</small
                  ></template
                >
              </td>
              <td>
                <span v-if="item.result.feasible" class="tag ok">可行</span>
                <span v-else class="tag fail">不可行</span>
              </td>
              <td>
                <template v-if="item.result.feasible">
                  {{ countsText(item.result.primary.counts) }}
                  <div class="muted">
                    {{ item.result.primary.notes }} 张 ·
                    <template v-if="item.result.hasMultiple"
                      >存在≥{{ Math.min(item.result.combinationCountAtLeast, 255) }}个组合</template
                    ><template v-else>仅一种组合</template>
                  </div>
                </template>
                <span v-else>—</span>
              </td>
              <td>
                <template v-if="item.result.feasible && item.result.alternative">
                  {{ countsText(item.result.alternative.counts) }}
                  <div class="muted">{{ item.result.alternative.notes }} 张</div>
                </template>
                <span v-else class="muted">无</span>
              </td>
              <td>
                <template v-if="!item.result.feasible">
                  <div>{{ item.result.message }}</div>
                  <div v-if="item.result.shortage" class="warn-text">
                    缺少 {{ item.result.shortage }} 元（最多凑到
                    {{ item.result.maxReachableBelow }} 元）
                  </div>
                </template>
                <span v-else class="muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 阶段二：预占结果 -->
    <div v-if="reserve" class="stage">
      <h3>
        ② 预占结果
        <span
          v-if="reserve.status === 'RESERVED'"
          class="tag reserved"
        >已提交 batch #{{ reserve.batchId }}</span>
        <span v-else class="tag fail">整批回滚（无任何库存改动）</span>
      </h3>
      <div v-if="reserve.status === 'RESERVED'" class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>#</th>
              <th>预占ID</th>
              <th>金额</th>
              <th>预占组合</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="rv in reserve.reservations" :key="rv.id">
              <td>{{ rv.seq + 1 }}</td>
              <td>#{{ rv.id }}</td>
              <td>{{ rv.requestedAmount }} 元</td>
              <td>{{ countsText(rv.planCounts) }}</td>
              <td><span class="tag reserved">{{ rv.status }}</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="rollback-box">
        <p><strong>事务已整体回滚：</strong>{{ reserve.error }}</p>
        <p v-if="typeof reserve.failedAtSeq === 'number'" class="muted">
          失败位置：第 {{ reserve.failedAtSeq + 1 }}
          笔。批次、预占记录、钞箱余量均未改变。
        </p>
      </div>
    </div>

    <!-- 阶段三：模拟出钞 -->
    <div v-if="phase === 'reserved' || phase === 'settled'" class="stage">
      <h3>③ 模拟出钞（模拟器不连接真实 ATM）</h3>
      <div class="sim-controls">
        <label>
          逐张拒钞概率
          <input
            v-model.number="rejectRate"
            type="number"
            min="0"
            max="1"
            step="0.05"
            style="width: 90px"
          />
        </label>
        <label>
          未完成张数比例（钞箱抽空模式）
          <input
            v-model.number="shortageRatio"
            type="number"
            min="0"
            max="1"
            step="0.05"
            style="width: 90px"
          />
        </label>
      </div>
      <div class="form-actions wrap">
        <button class="btn primary" :disabled="busy || phase !== 'reserved'" @click="doDispense('simulate')">
          按概率模拟（成功/拒钞）
        </button>
        <button class="btn ghost" :disabled="busy || phase !== 'reserved'" @click="doDispense('success')">
          全部成功
        </button>
        <button class="btn ghost" :disabled="busy || phase !== 'reserved'" @click="doDispense('reject')">
          全部拒钞
        </button>
        <button class="btn ghost" :disabled="busy || phase !== 'reserved'" @click="doDispense('shortage')">
          钞箱抽空（未完成）
        </button>
      </div>

      <div v-if="dispense" class="table-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th>#</th>
              <th>计划（预占）</th>
              <th>实际交付 ✅</th>
              <th>拒钞 ♻️</th>
              <th>未完成 ↩️</th>
              <th>状态</th>
              <th>回报说明</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in dispense.results" :key="r.reservationId">
              <td>{{ r.seq + 1 }}</td>
              <td>
                申请 {{ r.requestedAmount }}元<br />
                {{ countsText(r.planCounts) }}
              </td>
              <td class="delivered-cell">
                <strong>{{ r.deliveredAmount }} 元</strong>
                <div class="muted">{{ countsText(r.deliveredCounts) }}</div>
              </td>
              <td>
                <template v-if="r.rejectedAmount">
                  <span class="tag rejected">{{ r.rejectedAmount }}元</span>
                  <div class="muted">{{ countsText(r.rejectedCounts) }}</div>
                </template>
                <span v-else class="muted">0</span>
              </td>
              <td>
                <template v-if="r.unfinishedAmount">
                  <span class="tag warn">{{ r.unfinishedAmount }}元</span>
                  <div class="muted">{{ countsText(r.unfinishedCounts) }}（已释放）</div>
                </template>
                <span v-else class="muted">0</span>
              </td>
              <td>
                <span
                  class="tag"
                  :class="{
                    ok: r.status === 'DISPENSED',
                    partial: r.status === 'PARTIAL',
                    fail: r.status === 'FAILED',
                  }"
                  >{{ r.status }}</span
                >
              </td>
              <td><small>{{ r.note }}</small></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
