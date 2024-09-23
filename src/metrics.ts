import * as promClient from 'prom-client';

export const photoGenerationSummary = new promClient.Summary({
  name: 'photo_generation_duration',
  help: 'Duration of photo generation',
  labelNames: ['model'],
});
