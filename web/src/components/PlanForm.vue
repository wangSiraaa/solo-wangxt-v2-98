<script setup lang="ts">
import { ref } from 'vue';
import { yuanToCents } from '../api';

const ALL_DENOMS = [1000, 500, 200, 100];

interface Row {
  clientRef: string;
  amountYuan: string;
  denoms: number[];
  maxNotes: number;
}

const emit = defineEmits<{
  (
    e: 'plan',
    payload: {
      clientRef: string;
      amountCents: number;
      allowedDenominations: number[];
      maxNotes: number;
    }[],
  ): void;
}>();

const rows = ref<Row[]>([
  { clientRef: 'A1', amountYuan: '86', denoms: [...ALL_DENOMS], maxNotes: 50 },
]);

const error = ref('');
const busy = defineModel<boolean>('busy', { default: false });

function addRow() {
  const idx = rows.value.length + 1;
  rows.value.push({
    clientRef: `A${idx}`,
    amountYuan: '27',
    denoms: [1000, 500],
    maxNotes: 50,
  });
}

function addSmallChangeCase() {
  rows.value = [
    { clientRef: 'A1-86元-多组合', amountYuan: '86', denoms: [...ALL_DENOMS], maxNotes: 50 },
    { clientRef: 'A2-27元-缺零钱', amountYuan: '27', denoms: [1000, 500], maxNotes: 50 },
    { clientRef: 'A3-32元-全零钱', amountYuan: '32', denoms: [500, 200, 100], maxNotes: 50 },
  ];
}

function addCompetitionCase() {
  rows.value = [
    { clientRef: 'C1-86元', amountYuan: '86', denoms: [...ALL_DENOMS], maxNotes: 50 },
    { clientRef: 'C2-8元-仅1元', amountYuan: '8', denoms: [100], maxNotes: 50 },
  ];
}

function removeRow(i: number) {
  rows.value.splice(i, 1);
}

function toggleDenom(r: Row, d: number) {
  const i = r.denoms.indexOf(d);
  if (i >= 0) r.denoms.splice(i, 1);
  else r.denoms.push(d);
  r.denoms.sort((a, b) => b - a);
}

function submit() {
  error.value = '';
  try {
    const payload = rows.value.map((r) => {
      if (r.denoms.length === 0) throw new Error(`${r.clientRef} 至少选择一个允许面额`);
      const amountCents = yuanToCents(r.amountYuan);
      if (amountCents <= 0) throw new Error(`${r.clientRef} 金额必须大于 0`);
      if (!Number.isInteger(r.maxNotes) || r.maxNotes <= 0) {
        throw new Error(`${r.clientRef} 张数上限必须是正整数`);
      }
      return {
        clientRef: r.clientRef,
        amountCents,
        allowedDenominations: [...r.denoms],
        maxNotes: r.maxNotes,
      };
    });
    const refs = payload.map((p) => p.clientRef);
    if (new Set(refs).size !== refs.length) throw new Error('业务编号必须唯一');
    emit('plan', payload);
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <div class="panel">
    <h2>① 录入模拟取款申请（先生成计划，不预占库存）</h2>
    <div class="row" style="margin-bottom: 10px">
      <button class="secondary" @click="addSmallChangeCase">样例：小面额不足</button>
      <button class="secondary" @click="addCompetitionCase">样例：批内竞争</button>
      <button class="secondary" @click="addRow">+ 追加一笔</button>
    </div>
    <table>
      <thead>
        <tr>
          <th style="width: 130px">业务编号</th>
          <th style="width: 110px">金额（元）</th>
          <th>允许面额</th>
          <th style="width: 110px">张数上限</th>
          <th style="width: 50px"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(r, i) in rows" :key="i">
          <td><input v-model="r.clientRef" /></td>
          <td><input v-model="r.amountYuan" inputmode="decimal" /></td>
          <td>
            <div class="pill-group">
              <label
                v-for="d in ALL_DENOMS"
                :key="d"
                class="pill"
                :style="{
                  borderColor: r.denoms.includes(d) ? 'var(--accent)' : undefined,
                  color: r.denoms.includes(d) ? 'var(--text)' : undefined,
                }"
              >
                <input
                  type="checkbox"
                  :checked="r.denoms.includes(d)"
                  @change="toggleDenom(r, d)"
                />
                ¥{{ d / 100 }}
              </label>
            </div>
          </td>
          <td><input v-model.number="r.maxNotes" type="number" min="1" /></td>
          <td>
            <button class="danger" @click="removeRow(i)" :disabled="rows.length <= 1">
              删
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <div class="error-box" v-if="error">{{ error }}</div>
    <div class="row" style="margin-top: 10px; justify-content: flex-end">
      <button @click="submit" :disabled="busy">生成计划</button>
    </div>
    <p class="muted" style="margin-top: 8px">
      金额在前端即转为整数分（最多两位小数），后端全程有界整数运算，不使用浮点。
    </p>
  </div>
</template>
