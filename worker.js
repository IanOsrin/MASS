console.log('[worker] booting…');

setInterval(() => {
  console.log('[worker] alive', new Date().toISOString());
}, 15_000);


process.on('SIGTERM', () => {
  console.log('[worker] stopping');
  process.exit(0);
});
