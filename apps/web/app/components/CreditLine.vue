<script setup lang="ts">
import { licenceTerms } from '@closeup/shared';

/**
 * "Image: author, licence" wherever a player sees a picture's credit. A Creative Commons licence
 * links to its own page, and an attribution licence also says the picture was cropped: both are
 * what those licences ask of whoever shows the picture, and every card is cut into zoom levels.
 */
const props = defineProps<{ author: string; licence: string }>();
const terms = computed(() => licenceTerms(props.licence));
</script>

<template>
  <i18n-t
    :keypath="terms.attribution ? 'credit.lineCropped' : 'credit.line'"
    tag="span"
    scope="global"
  >
    <template #author>{{ author }}</template>
    <template #licence>
      <a v-if="terms.url" :href="terms.url" target="_blank" rel="license noopener noreferrer">
        {{ licence }}
      </a>
      <template v-else>{{ licence }}</template>
    </template>
  </i18n-t>
</template>
