import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

gsap.registerPlugin(ScrollTrigger);

const dinoMixers = [];
const clock = new THREE.Clock();
let car;
let isExploring = false;
let carSpeed = 0;
let carSteeringAngle = 0;
let carAngle = 0; // Current angle on the circular track
const TRACK_RADIUS = 80; // Circular road radius
const treePositions = [];

// --- Shaders ---
const sharedShaderCode = `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vPosition;
    varying vec3 vViewPosition;

    float hash(float n) { return fract(sin(n) * 43758.5453123); }
    float noise(vec3 x) {
        vec3 p = floor(x); vec3 f = fract(x);
        f = f*f*(3.0-2.0*f);
        float n = p.x + p.y*57.0 + 113.0*p.z;
        return mix(mix(mix(hash(n+0.0),hash(n+1.0),f.x),mix(hash(n+57.0),hash(n+58.0),f.x),f.y),
                   mix(mix(hash(n+113.0),hash(n+114.0),f.x),mix(hash(n+170.0),hash(n+171.0),f.x),f.y),f.z);
    }
    float fbm(vec3 p) {
        float f = 0.5*noise(p); p *= 2.02;
        f += 0.25*noise(p); p *= 2.03;
        f += 0.125*noise(p); p *= 2.01;
        f += 0.0625*noise(p);
        return f;
    }
`;

const planetVertexShader = `
    ${sharedShaderCode}
    void main() {
        vUv = uv; vNormal = normalize(normalMatrix * normal); vPosition = position;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

// --- Texture Loading ---
const textureLoader = new THREE.TextureLoader();
const earthDayMap = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg');
const earthNormalMap = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_normal_2048.jpg');
const earthSpecularMap = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_specular_2048.jpg');
const earthNightMap = textureLoader.load('https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_lights_2048.png');

const planetFragmentShader = `
    ${sharedShaderCode}
    uniform float uTime;
    uniform vec3 uColor1;
    uniform vec3 uColor2;
    uniform float uIsGas;
    uniform float uIsEarth;
    uniform sampler2D uMap;
    uniform sampler2D uNormalMap;
    uniform sampler2D uSpecularMap;
    uniform sampler2D uNightMap;
    uniform float uOpacity;

    void main() {
        vec3 pos = vPosition;
        vec2 uv = vUv;
        float n;
        
        if(uIsGas > 0.5) {
            n = fbm(vec3(pos.x * 0.1, pos.y * 2.0, pos.z * 0.1) + uTime * 0.1);
            n = mix(n, fbm(pos * 5.0 + uTime * 0.05), 0.3);
            vec3 color = mix(uColor1, uColor2, n);
            
            // Lighting for gas
            vec3 lightDir = normalize(vec3(1.0, 0.8, 1.2));
            float diff = max(dot(vNormal, lightDir), 0.2);
            color *= diff;
            
            float fresnel = pow(1.0 - dot(vNormal, normalize(vViewPosition)), 3.0);
            color += uColor1 * fresnel * 0.4;
            gl_FragColor = vec4(color, uOpacity);
            return;
        }

        // --- Rocky / Earth ---
        vec3 color;
        vec3 normal = vNormal;
        float specular = 0.1;

        if(uIsEarth > 0.5) {
            vec3 texColor = texture2D(uMap, uv).rgb;
            vec3 nightColor = texture2D(uNightMap, uv).rgb;
            vec3 normalColor = texture2D(uNormalMap, uv).rgb * 2.0 - 1.0;
            specular = texture2D(uSpecularMap, uv).r;
            
            // --- Enhanced 3D Lighting & Bump mapping ---
            vec3 lightDir = normalize(vec3(1.0, 0.8, 1.2));
            normal = normalize(vNormal + normalColor * 0.5);
            float diff = max(dot(normal, lightDir), 0.05);
            
            // Blend day and night based on light direction
            float dayNightMix = smoothstep(-0.2, 0.5, dot(vNormal, lightDir));
            color = mix(nightColor * 2.0, texColor, dayNightMix);
            
            // Clouds
            float clouds = fbm(pos * 1.5 + uTime * 0.03);
            clouds = smoothstep(0.4, 0.7, clouds);
            color = mix(color, vec3(0.9, 0.9, 1.0), clouds * 0.6 * dayNightMix);
        } else {
            n = fbm(pos * 1.5);
            float detail = fbm(pos * 6.0);
            float fine = fbm(pos * 20.0);
            n = n * 0.5 + detail * 0.4 + fine * 0.1;
            n = pow(n, 1.2); 
            color = mix(uColor1, uColor2, n);
            
            float delta = 0.01;
            float n_x = fbm((pos + vec3(delta, 0.0, 0.0)) * 4.0);
            float n_y = fbm((pos + vec3(0.0, delta, 0.0)) * 4.0);
            normal = normalize(vNormal + vec3(n_x - n, n_y - n, 0.0) * 0.5);
        }
        
        // Final Lighting
        vec3 lightDir = normalize(vec3(1.0, 0.8, 1.2));
        float diff = max(dot(normal, lightDir), 0.05);
        if(uIsEarth < 0.5) color *= diff;

        // Specular
        vec3 viewDir = normalize(vViewPosition);
        vec3 reflectDir = reflect(-lightDir, normal);
        float spec = pow(max(dot(viewDir, reflectDir), 0.0), uIsEarth > 0.5 ? 32.0 : 16.0);
        color += vec3(0.5, 0.6, 1.0) * spec * (uIsEarth > 0.5 ? specular : 0.1);
        
        // Atmosphere Glow
        float fresnel = pow(1.0 - dot(vNormal, normalize(vViewPosition)), 3.0);
        color += uColor1 * fresnel * 0.5;

        gl_FragColor = vec4(color, uOpacity);
    }
`;

const atmosphereVertexShader = `
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const atmosphereFragmentShader = `
    varying vec3 vNormal;
    varying vec3 vViewPosition;
    uniform vec3 uColor;
    uniform float uOpacity;
    void main() {
        float intensity = pow(0.7 - dot(vNormal, vec3(0, 0, 1.0)), 6.0);
        gl_FragColor = vec4(uColor, 1.0) * intensity * uOpacity;
    }
`;

const skyVertexShader = `
    varying vec3 vWorldPosition;
    void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const skyFragmentShader = `
    uniform vec3 topColor;
    uniform vec3 bottomColor;
    uniform vec3 sunColor;
    uniform vec3 sunDirection;
    varying vec3 vWorldPosition;
    void main() {
        vec3 viewDir = normalize(vWorldPosition);
        float h = viewDir.y;
        vec3 color = mix(bottomColor, topColor, max(h, 0.0));
        
        // Sun Glow
        float dist = dot(viewDir, normalize(sunDirection));
        float glow = pow(max(dist, 0.0), 80.0) * 0.5;
        float sun = pow(max(dist, 0.0), 800.0) * 2.0;
        color += sunColor * (glow + sun);
        
        gl_FragColor = vec4(color, 1.0);
    }
`;

const cloudVertexShader = `
    varying vec2 vUv;
    varying float vDistance;
    void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vDistance = -mvPosition.z;
        gl_Position = projectionMatrix * mvPosition;
    }
`;

const cloudFragmentShader = `
    varying vec2 vUv;
    varying float vDistance;
    uniform float uTime;
    uniform float uOpacity;

    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    float noise(vec2 p) {
        vec2 i = floor(p); vec2 f = fract(p);
        f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), f.x),
                   mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
    }

    void main() {
        vec2 uv = vUv * 2.0 - 1.0;
        float d = length(uv);
        float alpha = smoothstep(0.8, 0.2, d);
        
        // Fractal noise for cloud texture
        float n = noise(vUv * 4.0 + uTime * 0.05) * 0.5;
        n += noise(vUv * 8.0 - uTime * 0.02) * 0.25;
        
        alpha *= (0.5 + n);
        
        // Fade based on distance
        float fade = smoothstep(500.0, 100.0, vDistance);
        
        gl_FragColor = vec4(vec3(1.0), alpha * uOpacity * fade);
    }
`;


// Smooth Scroll
const lenis = new Lenis();
lenis.on('scroll', ScrollTrigger.update);

function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

// --- 3D Scene for Planet & Preloader ---
const canvas = document.getElementById('planet-canvas');
const preloaderCanvas = document.getElementById('preloader-canvas');

const gltfLoader = new GLTFLoader();

// Scene setup
const setup3D = (targetCanvas, isPreloader = false) => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, targetCanvas.clientWidth / targetCanvas.clientHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas: targetCanvas, antialias: true, alpha: true });
    renderer.setSize(targetCanvas.clientWidth, targetCanvas.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    let atmosphere;
    let innerWorld;

    if (isPreloader) {
        const planetColor1 = document.body.dataset.c1 || '#ffffff';
        const planetColor2 = document.body.dataset.c2 || '#888888';
        const isEarth = document.body.dataset.planet === 'earth';
        const geo = new THREE.SphereGeometry(1.8, 64, 64);
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor1: { value: new THREE.Color(planetColor1) },
                uColor2: { value: new THREE.Color(planetColor2) },
                uIsGas: { value: 0 },
                uIsEarth: { value: isEarth ? 1 : 0 },
                uMap: { value: earthDayMap },
                uNormalMap: { value: earthNormalMap },
                uSpecularMap: { value: earthSpecularMap },
                uNightMap: { value: earthNightMap },
                uOpacity: { value: 1.0 }
            },
            vertexShader: planetVertexShader,
            fragmentShader: planetFragmentShader,
            transparent: true
        });
        const mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);

        const ambient = new THREE.AmbientLight(0xffffff, 0.8);
        scene.add(ambient);
        const point = new THREE.PointLight(0xffffff, 80);
        point.position.set(5, 5, 5);
        scene.add(point);

        camera.position.z = 5;
        return { scene, camera, renderer, mesh, coreMesh: mesh };
    } else {
        const planetColor1 = document.body.dataset.c1 || '#ffffff';
        const planetColor2 = document.body.dataset.c2 || '#888888';
        const hasRings = document.body.dataset.rings === 'true';
        const isEarth = document.body.dataset.planet === 'earth';

        const geo = new THREE.SphereGeometry(2.2, 64, 64);
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uColor1: { value: new THREE.Color(planetColor1) },
                uColor2: { value: new THREE.Color(planetColor2) },
                uIsGas: { value: hasRings || planetColor2 === '#ffcc00' ? 1 : 0 },
                uIsEarth: { value: isEarth ? 1 : 0 },
                uMap: { value: earthDayMap },
                uNormalMap: { value: earthNormalMap },
                uSpecularMap: { value: earthSpecularMap },
                uNightMap: { value: earthNightMap },
                uOpacity: { value: 1.0 }
            },
            vertexShader: planetVertexShader,
            fragmentShader: planetFragmentShader,
            transparent: true
        });
        const mesh = new THREE.Mesh(geo, mat);
        const planetGroup = new THREE.Group();
        planetGroup.add(mesh);



        // Atmosphere Glow
        const atmosphereGeo = new THREE.SphereGeometry(2.4, 64, 64);
        const atmosphereMat = new THREE.ShaderMaterial({
            vertexShader: atmosphereVertexShader,
            fragmentShader: atmosphereFragmentShader,
            uniforms: {
                uColor: { value: new THREE.Color(planetColor1) },
                uOpacity: { value: 1.0 }
            },
            side: THREE.BackSide,
            transparent: true
        });
        atmosphere = new THREE.Mesh(atmosphereGeo, atmosphereMat);
        planetGroup.add(atmosphere);

        if (hasRings) {
            const planetType = document.body.dataset.planet;
            if (planetType === 'uranus') {
                const ringGeo = new THREE.RingGeometry(2.8, 3.5, 64);
                const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(planetColor2), side: THREE.DoubleSide, transparent: true, opacity: 0.3 });
                const ring = new THREE.Mesh(ringGeo, ringMat);
                ring.rotation.y = Math.PI / 2.2;
                planetGroup.add(ring);
            } else if (planetType === 'saturn') {
                [{ i: 3.0, o: 4.0, a: 0.4 }, { i: 4.2, o: 5.0, a: 0.2 }, { i: 5.2, o: 5.5, a: 0.1 }].forEach(r => {
                    const ringGeo = new THREE.RingGeometry(r.i, r.o, 64);
                    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(planetColor2), side: THREE.DoubleSide, transparent: true, opacity: r.a });
                    const ring = new THREE.Mesh(ringGeo, ringMat);
                    ring.rotation.x = Math.PI / 2.5;
                    planetGroup.add(ring);
                });
            } else {
                const ringGeo = new THREE.RingGeometry(2.5, 4.5, 64);
                const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(planetColor2), side: THREE.DoubleSide, transparent: true, opacity: 0.4 });
                const ring = new THREE.Mesh(ringGeo, ringMat);
                ring.rotation.x = Math.PI / 2.5;
                planetGroup.add(ring);
            }
        }
        scene.add(planetGroup);

        // --- Earth Specific Inner World ---
        if (isEarth) {
            innerWorld = new THREE.Group();
            innerWorld.position.z = -10;
            innerWorld.visible = false;
            scene.add(innerWorld);

            // Sky Dome
            const skyGeo = new THREE.SphereGeometry(450, 32, 15);
            const skyMat = new THREE.ShaderMaterial({
                uniforms: {
                    topColor: { value: new THREE.Color(0x0066cc) },
                    bottomColor: { value: new THREE.Color(0xaaccff) },
                    sunColor: { value: new THREE.Color(0xffffee) },
                    sunDirection: { value: new THREE.Vector3(50, 100, 50) }
                },
                vertexShader: skyVertexShader,
                fragmentShader: skyFragmentShader,
                side: THREE.BackSide,
                transparent: true,
                opacity: 0
            });
            const sky = new THREE.Mesh(skyGeo, skyMat);
            innerWorld.add(sky);

            // Sun Light (Warm, Golden Hour like the image)
            const sunLight = new THREE.DirectionalLight(0xffddaa, 2.5);
            sunLight.position.set(100, 150, 100);
            sunLight.castShadow = true;
            sunLight.shadow.mapSize.width = 4096; // Higher res shadows
            sunLight.shadow.mapSize.height = 4096;
            sunLight.shadow.camera.left = -200;
            sunLight.shadow.camera.right = 200;
            sunLight.shadow.camera.top = 200;
            sunLight.shadow.camera.bottom = -200;
            sunLight.shadow.bias = -0.0001;
            innerWorld.add(sunLight);

            const innerAmbient = new THREE.AmbientLight(0x404040, 0.6);
            innerWorld.add(innerAmbient);

            const hemiLight = new THREE.HemisphereLight(0x87ceeb, 0xe3c08d, 0.4);
            innerWorld.add(hemiLight);

            // =============================================
            // CURVED CIRCULAR ROAD ENVIRONMENT
            // =============================================

            // Grass ground covering everything
            const grassGeo = new THREE.PlaneGeometry(2000, 2000);
            const grassMat = new THREE.MeshStandardMaterial({ color: 0x3a6b2a, roughness: 1 });
            const grassMesh = new THREE.Mesh(grassGeo, grassMat);
            grassMesh.rotation.x = -Math.PI / 2;
            grassMesh.position.y = -10;
            grassMesh.receiveShadow = true;
            innerWorld.add(grassMesh);

            // Circular road surface using RingGeometry
            const roadGeo = new THREE.RingGeometry(TRACK_RADIUS - 10, TRACK_RADIUS + 10, 128);
            const roadMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
            const roadMesh = new THREE.Mesh(roadGeo, roadMat);
            roadMesh.rotation.x = -Math.PI / 2;
            roadMesh.position.y = -9.9;
            roadMesh.receiveShadow = true;
            innerWorld.add(roadMesh);

            // Center dashed line (middle of ring)
            const centerRadius = TRACK_RADIUS;
            const dashMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
            const numDashes = 60;
            for (let i = 0; i < numDashes; i++) {
                const angle = (i / numDashes) * Math.PI * 2;
                if (i % 2 === 0) { // Dashed every other
                    const dashGeo = new THREE.PlaneGeometry(0.5, (2 * Math.PI * centerRadius) / numDashes * 0.6);
                    const dash = new THREE.Mesh(dashGeo, dashMat);
                    dash.rotation.x = -Math.PI / 2;
                    dash.rotation.z = -angle;
                    dash.position.set(
                        Math.cos(angle) * centerRadius,
                        -9.85,
                        Math.sin(angle) * centerRadius
                    );
                    innerWorld.add(dash);
                }
            }

            // Barrier poles around the inner & outer edge
            const poleMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.4, metalness: 0.7 });
            const redTopMat = new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff0000, emissiveIntensity: 0.3 });
            [TRACK_RADIUS - 12, TRACK_RADIUS + 12].forEach(r => {
                for (let i = 0; i < 60; i++) {
                    const a = (i / 60) * Math.PI * 2;
                    const poleGeo = new THREE.CylinderGeometry(0.12, 0.12, 2, 8);
                    const pole = new THREE.Mesh(poleGeo, poleMat);
                    pole.position.set(Math.cos(a) * r, -9, Math.sin(a) * r);
                    innerWorld.add(pole);
                    const topGeo = new THREE.SphereGeometry(0.2, 6, 6);
                    const top = new THREE.Mesh(topGeo, redTopMat);
                    top.position.set(Math.cos(a) * r, -8, Math.sin(a) * r);
                    innerWorld.add(top);
                }
            });

            // Street lights around the track
            const lampMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.8 });
            const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0xffffcc, emissive: 0xffffcc, emissiveIntensity: 2 });
            const numLamps = 16;
            for (let i = 0; i < numLamps; i++) {
                const a = (i / numLamps) * Math.PI * 2;
                const r = TRACK_RADIUS + 16;
                const lpGeo = new THREE.CylinderGeometry(0.15, 0.15, 12, 8);
                const lp = new THREE.Mesh(lpGeo, lampMat);
                lp.position.set(Math.cos(a) * r, -4, Math.sin(a) * r);
                innerWorld.add(lp);
                const headGeo = new THREE.BoxGeometry(1.5, 0.4, 1.5);
                const head = new THREE.Mesh(headGeo, lampHeadMat);
                head.position.set(Math.cos(a) * (r - 3), 1.8, Math.sin(a) * (r - 3));
                innerWorld.add(head);
                const streetLight = new THREE.PointLight(0xffffcc, 40, 50);
                streetLight.position.set(Math.cos(a) * (r - 3), 1.5, Math.sin(a) * (r - 3));
                innerWorld.add(streetLight);
            }

            // Trees decorating inside and outside the track
            const greenTones = [0x2d5a27, 0x1e3f1a, 0x3d6e35];
            [TRACK_RADIUS - 25, TRACK_RADIUS + 25, TRACK_RADIUS + 35].forEach(r => {
                const count = Math.round(2 * Math.PI * r / 10);
                for (let i = 0; i < count; i++) {
                    const a = (i / count) * Math.PI * 2 + Math.random() * 0.2;
                    const trunkH = 6 + Math.random() * 5;
                    const trunkGeo = new THREE.CylinderGeometry(0.2, 0.5, trunkH);
                    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3d2b1f });
                    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
                    const fGeo = new THREE.ConeGeometry(3.5, 6, 8);
                    const fMat = new THREE.MeshStandardMaterial({ color: greenTones[Math.floor(Math.random() * greenTones.length)] });
                    const foliage = new THREE.Mesh(fGeo, fMat);
                    foliage.position.y = trunkH / 2 + 2;
                    const tree = new THREE.Group();
                    tree.add(trunk);
                    tree.add(foliage);
                    tree.position.set(Math.cos(a) * r, -10, Math.sin(a) * r);
                    innerWorld.add(tree);
                }
            });

            treePositions.length = 0; // No collision avoidance on circuit

            // Clouds (Better Procedural Billboards)
            const cloudGroup = new THREE.Group();
            const cloudMat = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                    uOpacity: { value: 0.4 }
                },
                vertexShader: cloudVertexShader,
                fragmentShader: cloudFragmentShader,
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide
            });
            for (let i = 0; i < 40; i++) {
                const cGeo = new THREE.PlaneGeometry(40, 25);
                const cloud = new THREE.Mesh(cGeo, cloudMat);
                cloud.position.set(
                    (Math.random() - 0.5) * 600,
                    Math.random() * 50 + 80,
                    (Math.random() - 0.5) * 600
                );
                cloud.rotation.x = Math.PI / 2; // Look down
                cloudGroup.add(cloud);
            }
            innerWorld.add(cloudGroup);

            // Flowing Sand Particles
            const sandCount = 1000;
            const sandGeo = new THREE.BufferGeometry();
            const sandPos = new Float32Array(sandCount * 3);
            const sandVel = new Float32Array(sandCount * 3);
            for (let i = 0; i < sandCount; i++) {
                sandPos[i * 3] = (Math.random() - 0.5) * 150;
                sandPos[i * 3 + 1] = (Math.random() - 0.5) * 80;
                sandPos[i * 3 + 2] = (Math.random() - 0.5) * 150;
                sandVel[i * 3] = (Math.random() - 0.5) * 0.15;
                sandVel[i * 3 + 1] = Math.random() * 0.02 + 0.01;
                sandVel[i * 3 + 2] = (Math.random() - 0.5) * 0.15;
            }
            sandGeo.setAttribute('position', new THREE.BufferAttribute(sandPos, 3));
            const sandMat = new THREE.PointsMaterial({ color: 0xccaa77, size: 0.03, transparent: true, opacity: 0 });
            const sandParticles = new THREE.Points(sandGeo, sandMat);
            innerWorld.add(sandParticles);

            innerWorld.userData = { groundMat: grassMat, sandMat: dashMat, sandPos: new Float32Array(0), sandVel: new Float32Array(0), skyMat, sandParticles: { geometry: { attributes: { position: { needsUpdate: false } } } }, cloudGroup, startTime: 0 };

            // --- Load Dinosaurs ---
            const loadDino = (path, scale, pos, rot, animIndex = 0) => {
                gltfLoader.load(path, (gltf) => {
                    const model = gltf.scene;
                    model.scale.set(scale, scale, scale);
                    model.position.copy(pos);
                    model.rotation.copy(rot);
                    model.traverse(n => { if (n.isMesh) n.castShadow = true; n.receiveShadow = true; });
                    innerWorld.add(model);

                    if (gltf.animations && gltf.animations.length > 0) {
                        const mixer = new THREE.AnimationMixer(model);
                        const action = mixer.clipAction(gltf.animations[animIndex]);
                        action.play();
                        dinoMixers.push(mixer);
                    }
                });
            };

            // --- BUILD REALISTIC SPORTS CAR ---
            const buildCar = () => {
                const carGroup = new THREE.Group();

                // Lower body (wide sporty base)
                const lowerBodyGeo = new THREE.BoxGeometry(4.4, 0.6, 9);
                const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff2200, roughness: 0.15, metalness: 0.85, envMapIntensity: 1 });
                const lowerBody = new THREE.Mesh(lowerBodyGeo, bodyMat);
                lowerBody.position.y = 0.5;
                lowerBody.castShadow = true;
                carGroup.add(lowerBody);

                // Upper body (tapered sportier profile)
                const upperBodyGeo = new THREE.BoxGeometry(4, 0.8, 7);
                const upperBody = new THREE.Mesh(upperBodyGeo, bodyMat);
                upperBody.position.set(0, 1.15, -0.3);
                upperBody.castShadow = true;
                carGroup.add(upperBody);

                // Hood (sloped front)
                const hoodGeo = new THREE.BoxGeometry(4, 0.15, 3);
                const hoodMesh = new THREE.Mesh(hoodGeo, bodyMat);
                hoodMesh.position.set(0, 1.1, 3.2);
                hoodMesh.rotation.x = 0.15;
                carGroup.add(hoodMesh);

                // Roof (dark glass-like)
                const roofMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.5 });
                const roofGeo = new THREE.BoxGeometry(3.2, 0.75, 3.8);
                const roof = new THREE.Mesh(roofGeo, roofMat);
                roof.position.set(0, 1.95, -0.5);
                carGroup.add(roof);

                // Windshield (angled glass)
                const glassMat = new THREE.MeshStandardMaterial({ color: 0x88ccff, roughness: 0, metalness: 0, transparent: true, opacity: 0.4 });
                const windGeo = new THREE.BoxGeometry(3.0, 1.0, 0.15);
                const wind = new THREE.Mesh(windGeo, glassMat);
                wind.position.set(0, 1.6, 1.45);
                wind.rotation.x = -0.45;
                carGroup.add(wind);

                // Rear window
                const rearWind = new THREE.Mesh(windGeo, glassMat);
                rearWind.position.set(0, 1.6, -2.5);
                rearWind.rotation.x = 0.45;
                carGroup.add(rearWind);

                // Spoiler
                const spoilerGeo = new THREE.BoxGeometry(4.2, 0.15, 0.8);
                const spoilerMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
                const spoiler = new THREE.Mesh(spoilerGeo, spoilerMat);
                spoiler.position.set(0, 1.8, -4.3);
                carGroup.add(spoiler);

                // Side skirts
                [-2.2, 2.2].forEach(x => {
                    const skirtGeo = new THREE.BoxGeometry(0.2, 0.4, 8.5);
                    const skirt = new THREE.Mesh(skirtGeo, spoilerMat);
                    skirt.position.set(x, 0.35, -0.3);
                    carGroup.add(skirt);
                });

                // Wheels (fat performance tires)
                const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.95 });
                const rimMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.1, metalness: 1 });
                const wheelPositions = [
                    [-2.3, 0, 3.0], [2.3, 0, 3.0],
                    [-2.3, 0, -3.0], [2.3, 0, -3.0]
                ];
                wheelPositions.forEach(([x, y, z], idx) => {
                    const wheelGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.7, 20);
                    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
                    wheel.rotation.z = Math.PI / 2;
                    wheel.position.set(x, y, z);
                    wheel.name = 'wheel';
                    carGroup.add(wheel);

                    // Rim spokes
                    const rimGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.72, 5);
                    const rim = new THREE.Mesh(rimGeo, rimMat);
                    rim.rotation.z = Math.PI / 2;
                    rim.position.set(x, y, z);
                    carGroup.add(rim);

                    // Brake disc
                    const discGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.1, 12);
                    const discMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.5, metalness: 0.8 });
                    const disc = new THREE.Mesh(discGeo, discMat);
                    disc.rotation.z = Math.PI / 2;
                    disc.position.set(x, y, z);
                    carGroup.add(disc);
                });

                // Headlights (glowing)
                const hlMat = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffee, emissiveIntensity: 3 });
                [-1.3, 1.3].forEach(x => {
                    const hlGeo = new THREE.BoxGeometry(0.7, 0.25, 0.15);
                    const hl = new THREE.Mesh(hlGeo, hlMat);
                    hl.position.set(x, 1.0, 4.55);
                    carGroup.add(hl);
                });

                // Taillights (red glow)
                const tlMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 2 });
                [-1.5, 1.5].forEach(x => {
                    const tlGeo = new THREE.BoxGeometry(0.6, 0.2, 0.1);
                    const tl = new THREE.Mesh(tlGeo, tlMat);
                    tl.position.set(x, 1.0, -4.55);
                    carGroup.add(tl);
                });

                // Grille
                const grilleMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
                const grilleGeo = new THREE.BoxGeometry(2.5, 0.5, 0.1);
                const grille = new THREE.Mesh(grilleGeo, grilleMat);
                grille.position.set(0, 0.55, 4.56);
                carGroup.add(grille);

                // Spotlight from headlights
                const headLight = new THREE.SpotLight(0xffffff, 200, 150, Math.PI / 5, 0.3);
                headLight.position.set(0, 2, 5);
                headLight.target.position.set(0, -5, 40);
                carGroup.add(headLight);
                carGroup.add(headLight.target);

                return carGroup;
            };

            car = buildCar();
            // Start at bottom of circle (facing toward default camera view)
            carAngle = -Math.PI / 2; // Bottom of circle = (0, y, -80)
            car.position.set(
                Math.cos(carAngle) * TRACK_RADIUS,
                -9.15, // Road surface -9.9 + wheel radius 0.75
                Math.sin(carAngle) * TRACK_RADIUS
            );
            car.rotation.y = -carAngle - Math.PI / 2;
            innerWorld.add(car);

            // --- "TAP TO START" Label on car ---
            const tapCanvas = document.createElement('canvas');
            tapCanvas.width = 512; tapCanvas.height = 128;
            const tapCtx = tapCanvas.getContext('2d');
            tapCtx.beginPath();
            tapCtx.roundRect(10, 10, 492, 108, 24);
            tapCtx.fillStyle = 'rgba(0,0,0,0.75)';
            tapCtx.fill();
            tapCtx.strokeStyle = 'rgba(255,255,255,0.6)';
            tapCtx.lineWidth = 2;
            tapCtx.stroke();
            tapCtx.font = 'Bold 44px Outfit';
            tapCtx.fillStyle = '#ffffff';
            tapCtx.textAlign = 'center';
            tapCtx.textBaseline = 'middle';
            tapCtx.fillText('TAP TO START', 256, 64);
            const tapTex = new THREE.CanvasTexture(tapCanvas);
            const tapLabel = new THREE.Sprite(new THREE.SpriteMaterial({ map: tapTex, transparent: true }));
            tapLabel.position.set(0, 3.5, 0);
            tapLabel.scale.set(6, 1.5, 1);
            car.add(tapLabel);
            car.userData.tapLabel = tapLabel;

            // Click to Explore (start circuit)
            window.addEventListener('click', (e) => {
                if (!car || !innerWorld.visible) return;
                const mouse = new THREE.Vector2(
                    (e.clientX / window.innerWidth) * 2 - 1,
                    -(e.clientY / window.innerHeight) * 2 + 1
                );
                const raycaster = new THREE.Raycaster();
                raycaster.setFromCamera(mouse, camera);
                const intersects = raycaster.intersectObject(car, true);
                if (intersects.length > 0 && !isExploring) {
                    isExploring = true;
                    carSpeed = 0;
                    // Hide tap label
                    if (car.userData.tapLabel) car.userData.tapLabel.visible = false;
                    lenis.stop();
                }
            });

            // --- Dinosaur removal complete ---
        }

        const ambient = new THREE.AmbientLight(0xffffff, 0.8);
        scene.add(ambient);
        const point = new THREE.PointLight(0xffffff, 100);
        point.position.set(10, 10, 10);
        scene.add(point);

        camera.position.z = 7;
        return { scene, camera, renderer, mesh: planetGroup, coreMesh: mesh, atmosphere, innerWorld };
    }
};

const preloader3D = setup3D(preloaderCanvas, true);
const planet3D = setup3D(canvas, false);

const animate = (time) => {
    time *= 0.001;

    preloader3D.mesh.rotation.y = time * 0.3;
    if (preloader3D.coreMesh && preloader3D.coreMesh.material.uniforms) {
        preloader3D.coreMesh.material.uniforms.uTime.value = time;
    }
    preloader3D.renderer.render(preloader3D.scene, preloader3D.camera);

    planet3D.mesh.rotation.y = time * 0.1;
    if (planet3D.coreMesh && planet3D.coreMesh.material.uniforms) {
        planet3D.coreMesh.material.uniforms.uTime.value = time;
    }

    // Animate Car on Circular Track
    if (car && isExploring) {
        // Smooth acceleration
        carSpeed += (0.012 - carSpeed) * 0.04; // Target: 0.012 rad/frame

        // Advance angle around the circle
        carAngle += carSpeed;

        // Position car on the circle
        car.position.x = Math.cos(carAngle) * TRACK_RADIUS;
        car.position.z = Math.sin(carAngle) * TRACK_RADIUS;
        car.position.y = -9.15; // On road surface

        // Rotate car to face the tangent (forward) direction
        // Tangent at angle θ is (-sin(θ), 0, cos(θ)), which corresponds to rotation.y = -θ
        car.rotation.y = -carAngle - Math.PI / 2;

        // Wheel spin
        car.traverse(n => { if (n.name === 'wheel') n.rotation.x -= carSpeed * 20; });

        // Camera behind the car (follow from behind along the tangent)
        const camAngle = carAngle - 0.3; // Slightly behind
        const camR = TRACK_RADIUS + 2; // Same radius as car
        const camX = Math.cos(camAngle) * camR;
        const camZ = Math.sin(camAngle) * camR;
        planet3D.camera.position.x += (camX - planet3D.camera.position.x) * 0.07;
        planet3D.camera.position.z += (camZ - planet3D.camera.position.z) * 0.07;
        planet3D.camera.position.y += (-8.5 + 7 - planet3D.camera.position.y) * 0.07;
        planet3D.camera.lookAt(car.position.x, car.position.y + 1, car.position.z);
    } else if (car) {
        carSpeed = 0;
        car.position.y = -9.15; // Keep on road surface
    }

    const delta = clock.getDelta();

    // Animate Inner World Sand & Clouds
    if (planet3D.innerWorld && planet3D.innerWorld.visible) {
        const { sandPos, sandVel, sandParticles, cloudGroup } = planet3D.innerWorld.userData;

        // Move and animate clouds
        cloudGroup.children.forEach((c, i) => {
            c.position.x += 0.03 * (i % 2 === 0 ? 1 : -1);
            if (Math.abs(c.position.x) > 500) c.position.x *= -1;
            if (c.material.uniforms) c.material.uniforms.uTime.value = time;
        });

        const attr = sandParticles.geometry.attributes.position;
        for (let i = 0; i < sandPos.length / 3; i++) {
            sandPos[i * 3] += sandVel[i * 3];
            sandPos[i * 3 + 1] += sandVel[i * 3 + 1];
            sandPos[i * 3 + 2] += sandVel[i * 3 + 2];

            if (sandPos[i * 3 + 1] > 30) sandPos[i * 3 + 1] = -30;
            if (Math.abs(sandPos[i * 3]) > 60) sandPos[i * 3] *= -0.95;
            if (Math.abs(sandPos[i * 3 + 2]) > 60) sandPos[i * 3 + 2] *= -0.95;
        }
        attr.needsUpdate = true;

        // Update Dino Animations
        dinoMixers.forEach(mixer => mixer.update(delta));
    }

    planet3D.renderer.render(planet3D.scene, planet3D.camera);
    requestAnimationFrame(animate);
};
requestAnimationFrame(animate);

window.addEventListener('resize', () => {
    [preloader3D, planet3D].forEach(obj => {
        const canvas = obj.renderer.domElement;
        obj.camera.aspect = canvas.clientWidth / canvas.clientHeight;
        obj.camera.updateProjectionMatrix();
        obj.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    });
});

window.addEventListener('load', () => {
    const tl = gsap.timeline();

    tl.to('#preloader', {
        opacity: 0,
        scale: 1.15,
        duration: 2.5,
        delay: 1,
        ease: 'expo.inOut',
        onStart: () => {
            const c1 = document.body.dataset.c1;
            if (c1) {
                gsap.to(document.body, {
                    background: `radial-gradient(circle at center, ${c1}33 0%, #05010a 100%)`,
                    duration: 2.5,
                    ease: 'expo.inOut'
                });
            }
            gsap.to('.loader-content h1', {
                letterSpacing: '8vw',
                opacity: 0,
                duration: 2,
                ease: 'expo.inOut'
            });
            gsap.to(preloader3D.mesh.rotation, {
                y: preloader3D.mesh.rotation.y + Math.PI,
                duration: 2.5,
                ease: 'expo.inOut'
            });
        },
        onComplete: () => {
            document.getElementById('preloader').style.display = 'none';
        }
    });

    tl.to('.planet-container', { opacity: 1, duration: 2 }, "-=2.2");
    tl.from('#planet-canvas', { scale: 0.4, opacity: 0, duration: 2.5, ease: 'expo.out' }, "-=2.2");
    tl.from('.planet-title', { y: 200, opacity: 0, duration: 2, ease: 'expo.out' }, "-=1.8");
    tl.from('.detail-section', { y: 100, opacity: 0, duration: 2, ease: 'expo.out' }, "-=1.5");
    tl.from('.stat-item', { y: 50, opacity: 0, stagger: 0.15, duration: 1.5, ease: 'expo.out' }, "-=1.2");

    window.addEventListener('mousemove', (e) => {
        const x = (e.clientX / window.innerWidth - 0.5) * 10;
        const y = (e.clientY / window.innerHeight - 0.5) * 10;
        gsap.to('.hero-section', {
            rotationY: x,
            rotationX: -y,
            duration: 1,
            ease: 'power2.out'
        });
    });

    // --- Earth Scroll Transition ---
    if (document.body.dataset.planet === 'earth') {
        const scrollTl = gsap.timeline({
            scrollTrigger: {
                trigger: "body",
                start: "top top",
                end: "bottom bottom",
                scrub: 1.5,
                pin: ".planet-container" // Pin the container to lock scroll at the end
            }
        });

        // 1. Zoom and move through
        scrollTl.to(planet3D.camera.position, { z: 1, ease: "power1.inOut" }, 0);

        // 2. Fade Earth and Atmosphere quickly
        scrollTl.to(planet3D.coreMesh.material.uniforms.uOpacity, { value: 0, ease: "power1.in" }, 0.05);
        if (planet3D.atmosphere) {
            scrollTl.to(planet3D.atmosphere.material.uniforms.uOpacity, { value: 0, ease: "power1.in" }, 0.05);
        }


        // 3. Reveal Inner World
        scrollTl.set(planet3D.innerWorld, { visible: true }, 0.3);
        scrollTl.to(planet3D.innerWorld.userData.groundMat, { opacity: 1, ease: "none" }, 0.4);
        scrollTl.to(planet3D.innerWorld.userData.sandMat, { opacity: 0.6, ease: "none" }, 0.4);
        scrollTl.to(planet3D.innerWorld.userData.skyMat, { opacity: 1, ease: "none" }, 0.4);

        // Add Fog on enter (More natural blue/green atmosphere)
        scrollTl.to(planet3D.scene, {
            onStart: () => { 
                planet3D.scene.fog = new THREE.FogExp2(0x88aabb, 0.008); 
                planet3D.renderer.toneMapping = THREE.ACESFilmicToneMapping;
                planet3D.renderer.toneMappingExposure = 1.1;
            },
            onReverseComplete: () => { 
                planet3D.scene.fog = null; 
                planet3D.renderer.toneMapping = THREE.NoToneMapping;
            }
        }, 0.3);

        // 4. Move camera into the desert (Raised Y to 15 for extra clearance)
        scrollTl.to(planet3D.camera.position, { z: -35, y: 15, ease: "power1.out" }, 0.3);
        scrollTl.to(planet3D.camera.rotation, { x: -0.15, ease: "power1.out" }, 0.3);

        // 5. Fade out page content as we go in
        scrollTl.to('.planet-container', { opacity: 0, pointerEvents: 'none', duration: 0.5 }, 0.2);
    }
});

