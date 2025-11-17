export default function handler(_req, res) {
  // Debug endpoint removed for production. Keep route inert to avoid
  // exposing filesystem or build metadata from deployed instances.
  res.status(404).json({ error: 'Not Found' });
}
