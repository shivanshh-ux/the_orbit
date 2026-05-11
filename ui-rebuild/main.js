import * as THREE from 'three';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import SplitType from 'split-type';

gsap.registerPlugin(ScrollTrigger);

// ─── 1. INITIALIZE LENIS ───
const lenis = new Lenis({
    duration: 1.2,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    smoothWheel: true
});

function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

// ─── 2. THREE.JS: THE ULTIMATE SOLAR SYSTEM ───
const canvas = document.getElementById('bg-canvas');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

camera.position.set(0, 30, 85);

// --- Advanced Procedural Shaders ---

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

// SUN SHADER
const sunVertexShader = `
    ${sharedShaderCode}
    void main() {
        vUv = uv; vNormal = normalize(normalMatrix * normal); vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
const sunFragmentShader = `
    ${sharedShaderCode}
    uniform float uTime;
    void main() {
        float n = fbm(vPosition * 0.5 + uTime * 0.2);
        vec3 color = mix(vec3(1.0, 0.9, 0.5), vec3(1.0, 0.4, 0.0), n * 1.5);
        float fresnel = pow(1.0 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.5);
        color += vec3(1.0, 0.9, 0.5) * fresnel * 2.0;
        gl_FragColor = vec4(color, 1.0);
    }
`;

// PLANET SHADER
const planetVertexShader = `
    ${sharedShaderCode}
    void main() {
        vUv = uv; vNormal = normalize(normalMatrix * normal); vPosition = position;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
    }
`;
const planetFragmentShader = `
    ${sharedShaderCode}
    uniform float uTime;
    uniform vec3 uColor1;
    uniform vec3 uColor2;
    uniform float uIsGas;

    void main() {
        vec3 pos = vPosition;
        float n;
        if(uIsGas > 0.5) n = fbm(vec3(pos.x * 0.1, pos.y * 2.0, pos.z * 0.1) + uTime * 0.1);
        else n = fbm(pos * 2.0);
        
        vec3 color = mix(uColor1, uColor2, n);
        float diff = max(dot(vNormal, normalize(vec3(1.0, 0.5, 1.0))), 0.2);
        color *= diff;
        
        float fresnel = pow(1.0 - dot(vNormal, normalize(vViewPosition)), 3.0);
        color += uColor2 * fresnel * 0.5;

        gl_FragColor = vec4(color, 1.0);
    }
`;

// NEBULA SHADER
const nebulaVertexShader = `
    varying vec2 vUv;
    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;
const nebulaFragmentShader = `
    ${sharedShaderCode}
    uniform float uTime;
    void main() {
        vec2 uv = vUv;
        float n = fbm(vec3(uv * 3.0, uTime * 0.05));
        vec3 color1 = vec3(0.05, 0.0, 0.1); // Deep Purple
        vec3 color2 = vec3(0.0, 0.05, 0.1); // Deep Blue
        vec3 color3 = vec3(0.1, 0.0, 0.05); // Deep Magenta
        
        vec3 finalColor = mix(color1, color2, n);
        finalColor = mix(finalColor, color3, fbm(vec3(uv * 5.0, -uTime * 0.03)));
        
        gl_FragColor = vec4(finalColor * 0.5, 1.0);
    }
`;


// --- Scene Setup ---
const sunMaterial = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 } }, vertexShader: sunVertexShader, fragmentShader: sunFragmentShader });
const sun = new THREE.Mesh(new THREE.SphereGeometry(5, 64, 64), sunMaterial);
scene.add(sun);

// --- Starfield ---
const starGeometry = new THREE.BufferGeometry();
const starCount = 15000;
const posArray = new Float32Array(starCount * 3);
const colorArray = new Float32Array(starCount * 3);

for (let i = 0; i < starCount * 3; i += 3) {
    posArray[i] = (Math.random() - 0.5) * 1000;
    posArray[i + 1] = (Math.random() - 0.5) * 1000;
    posArray[i + 2] = (Math.random() - 0.5) * 1000;
    
    // Pure white/blue stars
    colorArray[i] = 0.8 + Math.random() * 0.2;
    colorArray[i + 1] = 0.8 + Math.random() * 0.2;
    colorArray[i + 2] = 1.0;
}

starGeometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
starGeometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
const starMaterial = new THREE.PointsMaterial({ size: 0.7, vertexColors: true, transparent: true, opacity: 0.8 });
const stars = new THREE.Points(starGeometry, starMaterial);
scene.add(stars);




// --- Nebula Background ---
const nebulaMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: nebulaVertexShader,
    fragmentShader: nebulaFragmentShader,
    side: THREE.BackSide,
    transparent: true,
    opacity: 0.5
});
const nebula = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 32), nebulaMat);
scene.add(nebula);

const orbitGroup = new THREE.Group();
scene.add(orbitGroup);


const planetsData = [
    { name: 'Mercury', dist: 12, size: 0.8, speed: 0.8, c1: 0x888888, c2: 0xeeeeee, gas: 0, offset: Math.random() * Math.PI * 2 },
    { name: 'Venus', dist: 18, size: 1.2, speed: 0.6, c1: 0xff8800, c2: 0xffcc00, gas: 1, offset: Math.random() * Math.PI * 2 },
    { name: 'Earth', dist: 25, size: 1.4, speed: 0.45, c1: 0x0055ff, c2: 0x00ffff, gas: 0, offset: Math.random() * Math.PI * 2 },
    { name: 'Mars', dist: 32, size: 1.1, speed: 0.35, c1: 0xff4400, c2: 0xffaa66, gas: 0, offset: Math.random() * Math.PI * 2 },
    { name: 'Jupiter', dist: 45, size: 2.2, speed: 0.2, c1: 0xffaa00, c2: 0xffdd99, gas: 1, offset: Math.random() * Math.PI * 2 },
    { name: 'Saturn', dist: 60, size: 1.9, speed: 0.12, c1: 0xccaa88, c2: 0xffeedd, gas: 1, hasRings: true, offset: Math.random() * Math.PI * 2 },
    { name: 'Uranus', dist: 75, size: 1.3, speed: 0.08, c1: 0x00ffff, c2: 0x88ffff, gas: 1, offset: Math.random() * Math.PI * 2 },
    { name: 'Neptune', dist: 90, size: 1.2, speed: 0.05, c1: 0x0033ff, c2: 0x88aaff, gas: 1, offset: Math.random() * Math.PI * 2 }
];

// --- Label Creator ---
function createLabel(text) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 128;
    context.font = 'Bold 48px Outfit';
    context.fillStyle = 'rgba(255, 255, 255, 0.9)';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    
    // Add subtle shadow for legibility
    context.shadowColor = 'rgba(0, 0, 0, 0.5)';
    context.shadowBlur = 4;
    
    context.fillText(text.toUpperCase(), 128, 64);
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(6, 3, 1); 
    return sprite;
}

const planets = [];


planetsData.forEach(data => {
    const pPivot = new THREE.Group();
    orbitGroup.add(pPivot);

    const orbit = new THREE.Mesh(
        new THREE.TorusGeometry(data.dist, 0.04, 16, 200),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1 })
    );
    orbit.rotation.x = Math.PI / 2;
    orbitGroup.add(orbit); 

    const planetMat = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor1: { value: new THREE.Color(data.c1) },
            uColor2: { value: new THREE.Color(data.c2) },
            uIsGas: { value: data.gas }
        },
        vertexShader: planetVertexShader,
        fragmentShader: planetFragmentShader
    });
    const planet = new THREE.Mesh(new THREE.SphereGeometry(data.size, 64, 64), planetMat);
    planet.position.x = data.dist;
    pPivot.add(planet);

    if (data.hasRings) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(data.size * 1.5, data.size * 2.8, 64), new THREE.MeshBasicMaterial({ color: data.c2, transparent: true, opacity: 0.4, side: THREE.DoubleSide }));
        ring.rotation.x = Math.PI / 2.5;
        planet.add(ring);
    }

    const label = createLabel(data.name);
    label.position.y = data.size + 2; 
    planet.add(label);

    planets.push({ name: data.name, pivot: pPivot, mesh: planet, speed: data.speed, mat: planetMat, offset: data.offset });
});

// --- Lights ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);
const sunLight = new THREE.PointLight(0xffffff, 150, 300);
scene.add(sunLight);

const mouseLight = new THREE.PointLight(0xa78bfa, 50, 100);
scene.add(mouseLight);

// --- Animation ---
let mouseX = 0, mouseY = 0;
window.addEventListener('mousemove', (e) => {
    mouseX = (e.clientX / window.innerWidth - 0.5);
    mouseY = (e.clientY / window.innerHeight - 0.5);
    
    // Raycasting for interaction
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
});

window.addEventListener('click', () => {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(planets.map(p => p.mesh));
    
    if (intersects.length > 0) {
        const clickedMesh = intersects[0].object;
        const planetData = planets.find(p => p.mesh === clickedMesh);
        if (planetData) {
            window.location.href = `./${planetData.name.toLowerCase()}.html`;
        }
    }
});


function animate(time) {
    lenis.raf(time);
    requestAnimationFrame(animate);
    const t = time * 0.0005;
    const scroll = lenis.scroll / (document.body.scrollHeight - window.innerHeight);
    
    sunMaterial.uniforms.uTime.value = t;
    
    planets.forEach(p => {
        p.pivot.rotation.y = p.offset + t * p.speed + scroll * Math.PI * 1.2;
        p.mesh.rotation.y = t * 1.5;
        p.mat.uniforms.uTime.value = t;
    });

    stars.rotation.y = t * 0.02;
    nebulaMat.uniforms.uTime.value = t;


    
    orbitGroup.rotation.x = mouseY * 0.6 + scroll * 0.4;
    orbitGroup.rotation.z = mouseX * 0.2;
    
    camera.position.x += (mouseX * 20 - camera.position.x) * 0.03;
    camera.position.y += (30 - mouseY * 20 - camera.position.y) * 0.03;
    camera.position.z = 85 - scroll * 45;
    camera.lookAt(0, 0, 0);

    // Hover Cursor
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(planets.map(p => p.mesh));
    document.body.style.cursor = intersects.length > 0 ? 'pointer' : 'default';

    // Update Mouse Light
    const vector = new THREE.Vector3(mouseX * 2, -mouseY * 2, 0.5);
    vector.unproject(camera);
    const dir = vector.sub(camera.position).normalize();
    const distance = -camera.position.z / dir.z;
    const pos = camera.position.clone().add(dir.multiplyScalar(distance));
    mouseLight.position.copy(pos);
    renderer.render(scene, camera);
}
requestAnimationFrame(animate);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── 4. HERO ANIMATIONS ───
const splitTitles = new SplitType('.glitch, .section-title', { types: 'chars' });

// 3D RotationY (Spin in planet directions)
// Title entrance animation remains
gsap.from('.nav-title .char', { y: 50, opacity: 0, stagger: 0.02, duration: 1, ease: 'power4.out', delay: 0.5 });

// --- 5. PHILOSOPHY SECTION ANIMATIONS ---
const philosophyTitleChars = document.querySelectorAll('#about .section-title .char');
if (philosophyTitleChars.length > 0) {
    gsap.from(philosophyTitleChars, {
        scrollTrigger: {
            trigger: '#about',
            start: 'top 85%',
            toggleActions: 'play none none reverse'
        },
        opacity: 0,
        x: (i) => (i % 2 === 0 ? -50 : 50),
        y: (i) => (i % 2 === 0 ? 50 : -50),
        rotationZ: (i) => (i % 2 === 0 ? -45 : 45),
        filter: 'blur(10px)',
        stagger: 0.05,
        duration: 1.5,
        ease: 'elastic.out(1, 0.5)'
    });
}

const philosophyText = new SplitType('#about .hero-content', { types: 'words' });
if (philosophyText.words) {
    gsap.set(philosophyText.words, {
        opacity: 0.15,
        filter: 'blur(6px)',
        y: 20
    });

    gsap.to(philosophyText.words, {
        scrollTrigger: {
            trigger: '#about',
            start: 'top 75%',
            end: 'top 25%',
            scrub: true
        },
        opacity: 1,
        filter: 'blur(0px)',
        y: 0,
        stagger: 0.2,
        ease: 'power1.out'
    });
}
