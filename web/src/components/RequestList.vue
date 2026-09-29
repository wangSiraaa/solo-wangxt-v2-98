<script setup lang="ts">
import { computed, ref } from 'vue';
import type { CashRequestView } from '../api';
import { yuan } from '../api';

const props = defineProps<{
  requests: CashRequestView[];
  busy?: boolean;
}>();

const emit = defineEmits<{
  (
    e: 'reserve',
    payload: { ids: string[]; allOrNothing: boolean },
  ): void;
  (
    e: 'dispense',
    payload: { id: string; outcome: 'success' | 'reject' | 'partial'; delivered?: Record<string, number> },
  ): void;
}>();

const allOrNothing = ref(true);
// 部分出钞时，每张面额允许输入实际张数
const partialEditor = ref<Record<string, number>>({});
const partialOpenFor = ref<string | null>(null);

const selectable = computed(() =>
  props.requests.filter(
    (r) => r.planStatus === 'feasible' && r.reserveStatus === 'none',
  ),
);

function reserveAll() {
  emit(
    'reserve',
    { ids: selectable.value.map((r) => r.id), allOrNothing: allOrNothing.value },
  );
}

function statusLabel(s: string): string {
  return (
    {
      none: '仅计划',
      reserved: '已预占·未出钞',
      dispensed: '足额出钞',
      partial: '部分出钞',
      failed: '拒钞/失败',
    } as Record<string, string>
  )[s] ?? s;
}

function openPartial(r: CashRequestView) {
  partialOpenFor.value = r.id;
  const picked = r.options.find((o) => o.lines.some((l) => l.picked));
  partialEditor.value = {};
  // 默认模拟“只出了第一个面额”
  if (picked && picked.lines.length > 0) {
    const first = picked.lines[0];
    partialEditor.value[String(first.denomination)] = Math.max(
      1,
      Math.floor(first.reservedCount / 2),
    );
  }
}

function submitPartial(id: string) {
  const delivered: Record<string, number> = {};
  for (const [k, v] of Object.entries(partialEditor.value)) {
    if (v > 0) delivered[k] = v;
  }
  emit('dispense', { id, outcome: 'partial', delivered });
  partialOpenFor.value = null;
}

function pickedOption(r: CashRequestView) {
  return r.options.find((o) => o.lines.some((l) => l.picked));
}
</script>

<template>
  <div class="panel">
    <div class="row" style="justify-content: space-between">
      <h2>② 计划 · ③ 预占 · ④ 实际出钞结果</h2>
      <div class="row">
        <label class="row" style="gap: 4px">
          <input type="checkbox" v-model="allOrNothing" />
          整批事务（任一失败全部回滚）
        </label>
        <button :disabled="busy || selectable.length === 0" @click="reserveAll">
          事务预占选中的 {{ selectable.length }} 笔
        </button>
      </div>
    </div>

    <p v-if="requests.length === 0" class="muted">还没有计划。先生成一批计划。</p>

    <div v-for="r in requests" :key="r.id" class="request-card">
      <div class="row" style="justify-content: space-between">
        <div class="row" style="gap: 8px">
          <strong>{{ r.clientRef }}</strong>
          <span class="tag" :class="r.planStatus">
            {{ r.planStatus === 'feasible' ? '计划可行' : '计划不可行' }}
          </span>
          <span class="tag" :class="r.reserveStatus">{{ statusLabel(r.reserveStatus) }}</span>
        </div>
        <div class="muted">
          目标 {{ yuan(r.amountCents) }} · 上限 {{ r.maxNotes }} 张 · 允许
          {{ r.allowedDenominations.map((d) => '¥' + d / 100).join('/') }}
        </div>
      </div>

      <!-- 不可行解释 -->
      <div v-if="r.planStatus === 'infeasible'" class="reason">✗ {{ r.reason }}</div>

      <!-- 组合展示 -->
      <template v-else>
        <div class="muted" style="margin: 6px 0">
          枚举到 {{ r.optionCount }} 个可行组合（按总张数升序，0 号为推荐：张数最少）
        </div>
        <div
          v-for="opt in r.options"
          :key="opt.optionIndex"
          class="option-box"
          :class="{ picked: opt.lines.some((l) => l.picked) }"
        >
          <div class="row" style="justify-content: space-between">
            <span>
              组合 #{{ opt.optionIndex }}
              <span v-if="opt.lines.some((l) => l.picked)" class="tag dispensed">已选中并预占</span>
            </span>
            <span class="muted">{{ opt.totalNotes }} 张 · {{ yuan(opt.totalCents) }}</span>
          </div>
          <div class="pill-group" style="margin-top: 6px">
            <span
              v-for="l in opt.lines"
              :key="l.denomination"
              class="pill"
              :style="
                l.deliveredCount > 0
                  ? 'border-color: var(--green)'
                  : l.reservedCount > 0
                    ? 'border-color: var(--amber)'
                    : undefined
              "
            >
              {{ yuan(l.denomination) }} ×
              <strong>{{ l.plannedCount }}</strong>
              <template v-if="r.reserveStatus !== 'none'">
                <span class="muted">
                  / 预占 {{ l.reservedCount }} / 实出
                  <span :style="{ color: l.deliveredCount > 0 ? 'var(--green)' : undefined }">
                    {{ l.deliveredCount }}
                  </span>
                </span>
              </template>
            </span>
          </div>
        </div>
      </template>

      <!-- 金额核对条 -->
      <div v-if="r.reserveStatus !== 'none'" class="row" style="margin-top: 8px; gap: 16px">
        <span class="muted"
          >计划 {{ yuan(r.amountCents) }} · 预占
          <span style="color: var(--amber)">{{ yuan(r.reservedCents) }}</span> ·
          实际交付
          <strong :style="{ color: r.deliveredCents > 0 ? 'var(--green)' : 'var(--red)' }">
            {{ yuan(r.deliveredCents) }}
          </strong>
        </span>
        <span v-if="r.deliveredCents < r.amountCents && r.reserveStatus !== 'reserved'" class="tag failed">
          未完成 {{ yuan(r.amountCents - r.deliveredCents) }}（不能视为已交付）
        </span>
        <span v-if="r.reserveStatus === 'reserved'" class="tag reserved">
          现金尚未交付（预占 ≠ 出钞）
        </span>
      </div>

      <!-- 模拟器操作 -->
      <div v-if="r.reserveStatus === 'reserved'" class="row" style="margin-top: 8px">
        <button class="success" :disabled="busy" @click="emit('dispense', { id: r.id, outcome: 'success' })">
          模拟器：足额出钞
        </button>
        <button class="danger" :disabled="busy" @click="emit('dispense', { id: r.id, outcome: 'reject' })">
          模拟器：全部拒钞
        </button>
        <button class="warn" :disabled="busy" @click="openPartial(r)">模拟器：部分未完成…</button>
      </div>

      <!-- 部分出钞编辑 -->
      <div v-if="partialOpenFor === r.id && pickedOption(r)" class="option-box" style="margin-top: 8px">
        <div class="muted" style="margin-bottom: 6px">
          填报模拟器实际吐出的张数（留空或 0 = 该面额未出；至少 1 张，且不能足额）
        </div>
        <div class="row" v-for="l in pickedOption(r)!.lines" :key="l.denomination">
          <label style="width: 110px">{{ yuan(l.denomination) }}（预占 {{ l.reservedCount }}）</label>
          <input
            type="number"
            min="0"
            :max="l.reservedCount"
            v-model.number="partialEditor[String(l.denomination)]"
            style="width: 100px"
          />
        </div>
        <div class="row" style="justify-content: flex-end; margin-top: 8px">
          <button class="secondary" @click="partialOpenFor = null">取消</button>
          <button class="warn" @click="submitPartial(r.id)">回报部分出钞</button>
        </div>
      </div>
    </div>
  </div>
</template>
