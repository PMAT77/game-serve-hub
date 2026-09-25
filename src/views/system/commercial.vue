<script setup lang="ts">
import CommercialSupportSection from './CommercialSupportSection.vue'

defineOptions({
  name: 'SystemCommercial',
})
</script>

<template>
  <FaPageMain class="h-full gap-4"> 
    <div>
      <h2 class="m-0 text-lg font-semibold">
        商业支持与 Pro
      </h2> 
    </div>
    <CommercialSupportSection />
  </FaPageMain>
</template>
