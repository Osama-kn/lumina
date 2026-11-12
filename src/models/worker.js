// Reads a 3D file and samples it into particles off the main thread, so a big
// model never freezes the page. registry.js sends jobs; replies carry the model
// with its arrays transferred (not copied).
import { parseGltf } from './gltf.js';
import { meshToModel } from './mesh-model.js';

self.onmessage = ({ data }) => {
  const { id, buffer, details, n, seed, name } = data;
  try {
    const model = meshToModel(parseGltf(buffer).meshes, details, n, seed, name);
    self.postMessage({ id, model }, [model.target.buffer, model.centers.buffer, model.anchors.buffer]);
  } catch (err) {
    self.postMessage({ id, error: { code: err.code ?? 'error', message: err.message } });
  }
};
