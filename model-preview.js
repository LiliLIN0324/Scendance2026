import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas=document.getElementById('model-canvas');
const state=document.getElementById('model-state');
const labels={table:'团队会议桌',chair:'活动座椅',laptop:'笔记本电脑',plant:'场馆绿植',speaker:'舞台音箱'};
let view,controls,scene,camera,current,selection=0;
const cache=new Map();
try{
  view=new THREE.WebGLRenderer({canvas,antialias:true});
  view.setPixelRatio(Math.min(devicePixelRatio,2));
  view.shadowMap.enabled=true;view.shadowMap.type=THREE.PCFShadowMap;
  view.toneMapping=THREE.ACESFilmicToneMapping;view.toneMappingExposure=1.1;
  scene=new THREE.Scene();scene.background=new THREE.Color('#f1f3f6');
  camera=new THREE.PerspectiveCamera(38,1,.01,100);camera.position.set(3.5,2.7,4.2);
  controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.minDistance=.7;controls.maxDistance=10;controls.maxPolarAngle=Math.PI*.49;
  const room=new RoomEnvironment();const pmrem=new THREE.PMREMGenerator(view);const environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;scene.environmentIntensity=.5;room.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff,0x9aa789,2));
  const sun=new THREE.DirectionalLight(0xfff5de,3);sun.position.set(4,7,5);sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-4;sun.shadow.camera.right=4;sun.shadow.camera.top=4;sun.shadow.camera.bottom=-4;sun.shadow.bias=-.001;scene.add(sun);
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0xe9ece3,roughness:.93}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground);
  const loader=new GLTFLoader();
  const response=await fetch('assets/catalogue.json');if(!response.ok)throw new Error('Catalogue unavailable');
  const {assets}=await response.json();
  async function select(asset){
    const request=++selection;state.textContent='正在加载 '+labels[asset.role]+'…';
    document.querySelectorAll('#models button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.id===asset.id)));
    try{
      if(!cache.has(asset.id))cache.set(asset.id,loader.loadAsync(asset.localPath));
      const gltf=await cache.get(asset.id);if(request!==selection)return;
      if(current)scene.remove(current);
      current=new THREE.Group();const object=gltf.scene.clone(true);object.updateMatrixWorld(true);
      const box=new THREE.Box3().setFromObject(object),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
      object.position.sub(new THREE.Vector3(center.x,box.min.y,center.z));current.add(object);current.scale.setScalar(2.4/Math.max(size.x,size.y,size.z));current.position.y=.006;
      object.traverse(node=>{if(node.isMesh){node.castShadow=true;node.receiveShadow=true;}});scene.add(current);
      controls.target.set(0,size.y*current.scale.x*.45,0);camera.position.set(3.5,2.7,4.2);controls.update();
      document.getElementById('model-name').textContent=labels[asset.role];document.getElementById('model-meta').textContent=`${asset.title} · ${asset.triangles.toLocaleString()} 个三角形 · CC0`;
      document.getElementById('model-source').href=asset.sourceUrl;document.getElementById('model-download').href=asset.localPath;document.getElementById('model-download').download=asset.role+'.glb';
      state.textContent='已载入 · 拖动查看每个角度';state.dataset.loaded=asset.id;
    }catch(error){state.textContent='模型加载失败，请刷新后重试。';cache.delete(asset.id);console.error(error);}
  }
  for(const asset of assets){const button=document.createElement('button');button.className='button';button.textContent=labels[asset.role];button.dataset.id=asset.id;button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>select(asset));document.getElementById('models').append(button);}
  const initial=new URLSearchParams(location.search).get('asset');select(assets.find(a=>a.id===initial)||assets[0]);
  const resize=()=>{const {width,height}=canvas.getBoundingClientRect();camera.aspect=width/height;camera.updateProjectionMatrix();view.setSize(width,height,false);};
  new ResizeObserver(resize).observe(canvas.parentElement);resize();view.setAnimationLoop(()=>{if(document.hidden)return;controls.update();view.render(scene,camera);});
  window.addEventListener('pagehide',()=>view.setAnimationLoop(null));
}catch(error){state.textContent='三维预览无法启动，请使用支持 WebGL 的浏览器。';console.error(error);}
