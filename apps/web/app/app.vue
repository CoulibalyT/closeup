<script setup lang="ts">
// Only the `lang` attribute for now. useLocaleHead() also builds hreflang and canonical links,
// which need the public base URL: that comes with the landing page, along with SEO exclusions.
const { localeProperties } = useI18n();
useHead(() => ({ htmlAttrs: { lang: localeProperties.value.language } }));
</script>

<template>
  <VitePwaManifest />
  <NuxtPage />
</template>
