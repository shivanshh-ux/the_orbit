import { gsap } from 'gsap';
import Lenis from 'lenis';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

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
            gl_FragColor = vec4(color, 1.0);
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

        gl_FragColor = vec4(color, 1.0);
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
    void main() {
        float intensity = pow(0.7 - dot(vNormal, vec3(0, 0, 1.0)), 6.0);
        gl_FragColor = vec4(uColor, 1.0) * intensity;
    }
`;


// Smooth Scroll
const lenis = new Lenis();

function raf(time) {
    lenis.raf(time);
    requestAnimationFrame(raf);
}
requestAnimationFrame(raf);

// --- 3D Scene for Planet & Preloader ---
const canvas = document.getElementById('planet-canvas');
const preloaderCanvas = document.getElementById('preloader-canvas');

const gltfLoader = new GLTFLoader();
let astronautModel;
gltfLoader.load('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Astronaut/glTF-Binary/Astronaut.glb', (gltf) => {
    astronautModel = gltf.scene;
});

// Scene setup
const setup3D = (targetCanvas, isPreloader = false) => {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, targetCanvas.clientWidth / targetCanvas.clientHeight, 0.1, 1000);
    const renderer = new THREE.WebGLRenderer({ canvas: targetCanvas, antialias: true, alpha: true });
    renderer.setSize(targetCanvas.clientWidth, targetCanvas.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);

    let astronaut;

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
                uNightMap: { value: earthNightMap }
            },
            vertexShader: planetVertexShader,
            fragmentShader: planetFragmentShader
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
                uNightMap: { value: earthNightMap }
            },
            vertexShader: planetVertexShader,
            fragmentShader: planetFragmentShader
        });
        const mesh = new THREE.Mesh(geo, mat);
        const planetGroup = new THREE.Group();
        planetGroup.add(mesh);

        // Add 3D Astronaut if model is loaded
        if (astronautModel) {
            astronaut = astronautModel.clone();
            astronaut.scale.set(0.6, 0.6, 0.6);
            astronaut.position.set(3, -1, 3);
            astronaut.rotation.y = -Math.PI / 4;
            scene.add(astronaut);
        } else {
            setTimeout(() => {
                if (astronautModel && !astronaut) {
                    astronaut = astronautModel.clone();
                    astronaut.scale.set(0.6, 0.6, 0.6);
                    astronaut.position.set(3, -1, 3);
                    scene.add(astronaut);
                }
            }, 1000);
        }

        // Atmosphere Glow
        const atmosphereGeo = new THREE.SphereGeometry(2.4, 64, 64);
        const atmosphereMat = new THREE.ShaderMaterial({
            vertexShader: atmosphereVertexShader,
            fragmentShader: atmosphereFragmentShader,
            uniforms: { uColor: { value: new THREE.Color(planetColor1) } },
            side: THREE.BackSide,
            transparent: true
        });
        const atmosphere = new THREE.Mesh(atmosphereGeo, atmosphereMat);
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

        const ambient = new THREE.AmbientLight(0xffffff, 0.8);
        scene.add(ambient);
        const point = new THREE.PointLight(0xffffff, 100);
        point.position.set(10, 10, 10);
        scene.add(point);

        camera.position.z = 7;
        return { scene, camera, renderer, mesh: planetGroup, coreMesh: mesh, astronaut };
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

    if (planet3D.astronaut) {
        planet3D.astronaut.position.y = -1 + Math.sin(time * 0.5) * 0.2;
        planet3D.astronaut.position.x = 3 + Math.cos(time * 0.3) * 0.1;
        planet3D.astronaut.rotation.z = Math.sin(time * 0.4) * 0.1;
        planet3D.astronaut.rotation.y = -Math.PI / 4 + Math.sin(time * 0.2) * 0.2;
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
});


