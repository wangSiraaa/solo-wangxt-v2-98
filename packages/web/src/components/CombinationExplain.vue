<script setup lang="ts">
import type { SolveResult } from '../types';

defineProps<{ result: SolveResult | null }>();

const reasonText: Record<string, string> = {
  AMOUNT_INVALID: '输入不合法',
  NO_DENOMINATION: '没有可用面额',
  INSUFFICIENT_TOTAL_STOCK: '允许面额总价值不足',
  GCD_NOT_DIVISIBLE: '金额无法被面额公约整除',
  NOTE_LIMIT: '单笔张数上限挡死',
  SMALL_DENOM_SHORTAGE: '小面额（找零）不足',
  NO_COMBINATION: '库存组合无法凑出',
};
</script>

<template>
  <div v-if="!result" class="explain empty">
    输入金额、允许面额与张数上限后点击“试算”，这里给出组合或无解解释。
  </div>

  <div v-else-if="result.feasible" class="explain feasible">
    <div class="explain-head">
      <span class="tag ok">可行组合</span>
      <span class="muted">
        目标 {{ result.amount }} 元 · 张数上限 {{ result.maxNotes }} ·
        不同组合
        <strong>
          ≥{{ Math.min(result.combinationCountAtLeast, 255)
          }}<template v-if="result.combinationCountAtLeast >= 255">+</template>
        </strong>
        个<template v-if="!result.hasMultiple">（仅此一种）</template>
      </span>
    </div>

    <div class="combos">
      <div class="combo primary-combo">
        <div class="combo-title">
          主推荐组合（优先大面额 · 张数最少：{{ result.primary.notes }} 张）
        </div>
        <div class="notes-row">
          <span
            v-for="(q, d) in result.primary.counts"
            :key="'p' + d"
            class="note-chip"
          >
            <b>{{ d }}</b> 元 × {{ q }} 张
            <em>= {{ Number(d) * q }} 元</em>
          </span>
        </div>
        <div class="combo-total">
          合计 {{ result.primary.total }} 元 / {{ result.primary.notes }} 张
        </div>
      </div>

      <div v-if="result.alternative" class="combo alt-combo">
        <div class="combo-title">
          备选组合（{{ result.alternative.notes }} 张，与主组合不同）
        </div>
        <div class="notes-row">
          <span
            v-for="(q, d) in result.alternative.counts"
            :key="'a' + d"
            class="note-chip alt"
          >
            <b>{{ d }}</b> 元 × {{ q }} 张
            <em>= {{ Number(d) * q }} 元</em>
          </span>
        </div>
        <div class="combo-total">
          合计 {{ result.alternative.total }} 元 /
          {{ result.alternative.notes }} 张
        </div>
      </div>
      <div v-else class="combo alt-combo no-alt">
        在当前库存与张数上限下，该金额只有上面一种组合，不存在备选。
      </div>
    </div>
  </div>

  <div v-else class="explain infeasible">
    <div class="explain-head">
      <span class="tag fail">无可行组合</span>
      <span class="reason-code">{{ reasonText[result.reasonCode] || result.reasonCode }}</span>
    </div>
    <p class="message">{{ result.message }}</p>
    <ul class="diagnose">
      <li v-if="result.shortage !== undefined">
        缺少的金额：<b>{{ result.shortage }} 元</b>
        （允许面额最多凑到
        {{ result.maxReachableBelow }} 元，目标 {{ result.amount }} 元）
      </li>
      <li v-if="result.greedyRemainder !== undefined">
        贪心（大面额优先）尾差：{{ result.greedyRemainder }} 元 ——
        需由 1/5/10 等小面额补齐
      </li>
      <li v-if="result.minNotesWithoutLimit !== undefined">
        理论最少张数（不限上限）：{{ result.minNotesWithoutLimit }} 张<template
          v-if="result.maxNotes !== undefined"
        >，上限 {{ result.maxNotes }} 张</template>
      </li>
      <li v-if="result.totalStockValue !== undefined">
        允许面额总价值：{{ result.totalStockValue }} 元
      </li>
      <li v-if="result.gcd !== undefined">
        面额最大公约数：{{ result.gcd }}（金额必须能被其整除）
      </li>
    </ul>
  </div>
</template>
