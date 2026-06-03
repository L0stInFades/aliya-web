<template>
  <div class="resource-bar">
    <div class="resource o2">
      <span class="icon">O₂</span>
      <div class="bar">
        <div class="fill" :style="{ width: o2Percent * 100 + '%' }"></div>
      </div>
      <span class="value">{{ Math.round(gameState.o2) }}%</span>
    </div>
    
    <div class="resource water">
      <span class="icon">H₂O</span>
      <div class="bar">
        <div class="fill" :style="{ width: waterPercent * 100 + '%' }"></div>
      </div>
      <span class="value">{{ Math.round(gameState.water) }}%</span>
    </div>
    
    <div class="resource energy">
      <span class="icon">ENG</span>
      <div class="bar">
        <div class="fill" :style="{ width: energyPercent * 100 + '%' }"></div>
      </div>
      <span class="value">{{ Math.round(gameState.energy) }}%</span>
    </div>
    
    <div class="resource hr">
      <span class="icon">HR</span>
      <span class="value">{{ gameState.heartRate }} bpm</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useGameStore } from '../stores/game'

const store = useGameStore()
const { gameState, o2Percent, waterPercent, energyPercent } = storeToRefs(store)
</script>

<style scoped>
.resource-bar {
  display: flex;
  gap: 8px;
  flex: 0 0 39px;
  min-height: 39px;
  padding: 7px 12px;
  background: rgba(246, 246, 248, 0.78);
  border-top: 1px solid rgba(60, 60, 67, 0.12);
  backdrop-filter: blur(24px) saturate(1.25);
  -webkit-backdrop-filter: blur(24px) saturate(1.25);
}

.resource {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  min-height: 24px;
}

.icon {
  font-size: 10px;
  min-width: 22px;
  text-align: center;
  color: rgba(60, 60, 67, 0.62);
  letter-spacing: 0;
  font-weight: 600;
}

.bar {
  flex: 1;
  min-width: 14px;
  height: 5px;
  background: rgba(120, 120, 128, 0.18);
  border-radius: 999px;
  overflow: hidden;
}

.fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.3s ease;
}

.o2 .fill {
  background: #32ade6;
}

.water .fill {
  background: #0a84ff;
}

.energy .fill {
  background: #ffd60a;
}

.value {
  font-size: 10px;
  color: rgba(60, 60, 67, 0.64);
  min-width: 34px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.hr .value {
  color: #ff3b30;
  min-width: 52px;
}

@media (max-width: 420px) {
  .resource-bar {
    gap: 5px;
    padding-left: 9px;
    padding-right: 9px;
  }

  .icon {
    min-width: auto;
  }

  .resource.hr {
    flex: 0 0 auto;
  }

  .value {
    min-width: 28px;
  }
}

@media (prefers-color-scheme: dark) {
  .resource-bar {
    background: rgba(28, 28, 30, 0.78);
    border-top-color: rgba(255, 255, 255, 0.08);
  }

  .icon,
  .value {
    color: rgba(235, 235, 245, 0.6);
  }

  .bar {
    background: rgba(120, 120, 128, 0.28);
  }
}
</style>
