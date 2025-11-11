import * as THREE from "https://esm.sh/three";

// ========== AR 初始化 ==========
// 使用攝像頭功能
const ARCanvas = document.getElementById('glscene');
const ARRenderer = new THREE.WebGLRenderer({
    canvas: ARCanvas,
    alpha: false,
    antialias: true
});
ARRenderer.setSize(window.innerWidth, window.innerHeight);
ARRenderer.setPixelRatio(window.devicePixelRatio);

// ========== Three.js 基礎設定 ==========
const camera = new THREE.PerspectiveCamera( 
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.set(0, 1.6, 0); // 眼睛高度

const scene = new THREE.Scene();
scene.background = null; // 攝像頭會設為背景

// ========== 攝像頭背景設定 ==========
let videoCameraStream = null;
let videoTexture = null;
let videoElement = null;

async function initializeCamera() {
    try {
        console.log("📷 請求相機權限...");

        videoCameraStream = await navigator.mediaDevices.getUserMedia({
            video: { 
                facingMode: 'environment',
            }
        });

        videoElement = document.createElement('video');
        videoElement.srcObject = videoCameraStream;
        videoElement.setAttribute('playsinline', ''); // iOS 必需
        videoElement.setAttribute('webkit-playsinline', ''); // iOS 舊版本
        videoElement.autoplay = true;
        videoElement.muted = true; // iOS 必需靜音才能自動播放

        // 等待影片準備好
        await new Promise((resolve, reject) => {
            videoElement.onloadedmetadata = () => {
                videoElement.play()
                    .then(() => {
                        console.log("✅ 影片開始播放");
                        resolve();
                    })
                    .catch(reject);
            };
            videoElement.onerror = reject;
        });

        // 建立攝像頭紋理
        videoTexture = new THREE.VideoTexture(videoElement);
        videoTexture.colorSpace = THREE.SRGBColorSpace;
        scene.background = videoTexture;

        console.log("✅ 攝像頭已啟動");
        console.log(`   影片尺寸: ${videoElement.videoWidth}x${videoElement.videoHeight}`);

        return true;
    } catch (error) {
        console.error("❌ 攝像頭錯誤:", error);
        alert(`攝像頭錯誤: ${error.message}\n\n請確認:\n1. 已授予相機權限\n2. 沒有其他 App 使用相機\n3. 使用 HTTPS 或 localhost`);
        return false;
    }
}

// ========== 陀螺儀控制 (原生 API) ==========
class DeviceOrientationController {
    constructor(camera) {
        this.camera = camera;
        this.alpha = 0; 
        this.beta = 0;  
        this.gamma = 0;
        this.initialYaw = null; // 新增：初始羅盤方向
        this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
        this.quaternion = new THREE.Quaternion();

        // 記錄陀螺儀初始狀態
        console.log("📡 陀螺儀控制器已初始化");
        console.log(`   初始姿態 - Alpha: ${this.alpha}°, Beta: ${this.beta}°, Gamma: ${this.gamma}°`);
    }

    async init() {
        if (typeof DeviceOrientationEvent !== 'undefined') { 
            if (typeof DeviceOrientationEvent.requestPermission === 'function') {
                console.warn("⚠️ 請透過按鈕點擊授權陀螺儀功能。");
            } else {
                // Android 和其他裝置
                this.connect();
                console.log("✅ 陀螺儀已連接 (Android/其他)");
            }
        } else {
            console.error("❌ 裝置不支援 DeviceOrientationEvent");
            alert("您的裝置或瀏覽器不支援陀螺儀功能。");
        }
    }

    connect() {
        const handleOrientation = (event) => {
            if (this.initialYaw === null && event.alpha !== null) {
                // 記錄第一次獲取到的 alpha 值作為初始羅盤方向
                this.initialYaw = THREE.MathUtils.degToRad(event.alpha);
                console.log(`✅ 初始羅盤方向已校準: ${(this.initialYaw * 180 / Math.PI).toFixed(2)}°`);
            }

            this.alpha = THREE.MathUtils.degToRad(event.alpha || 0);
            this.beta = THREE.MathUtils.degToRad(event.beta || 0);
            this.gamma = 0; // 固定為 0，保持訊號點水平
        };

        window.addEventListener('deviceorientation', handleOrientation, false);

        console.log("📡 陀螺儀事件監聽器已連接");
    }

    update() {
        // 根據手機方向調整
        // beta - 90度：補償手機直立時的角度差異
        // alpha - initialYaw：校準羅盤,讓初始方向為 Z 軸負方向
        this.euler.set(
            this.beta - Math.PI / 2,  // X 軸：補償 90 度 (右手坐標系)
            this.alpha - (this.initialYaw || 0), // Y 軸：校準後的左右旋轉
            0                         // Z 軸：固定為 0，保持水平（訊號點不隨手機傾斜）
        );

        this.camera.quaternion.setFromEuler(this.euler);
    }
}

const deviceOrientationControls = new DeviceOrientationController(camera);

// ========== 視窗調整 ==========
window.addEventListener("resize", ev => {
    ARRenderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
});

// ========== 室內訊號點資料 (使用 XYZ 座標) ==========
// x: 左右 (正=右), y: 上下 (正=上), z: 前後 (負=前方)
const INDOOR_SIGNAL_POINTS = [
    { x: 0, y: 0, z: -5, power: 90, name: "訊號點 A" },
    { x: -3, y: 0, z: 0, power: 5, name: "訊號點 B" },
    { x: -3, y: 0, z: -3, power: 30, name: "訊號點 C" },
    { x: 0, y: 0, z: -10, power: 50, name: "訊號點 D" },
    { x: 5, y: 0, z: -2, power: 70, name: "訊號點 E" },
    { x: -5, y: 0, z: -2, power: 10, name: "訊號點 F" }
];

// ========== Material 快取 ==========
const materialCache = new Map();

function getMaterialForColor(color) {
    if (!materialCache.has(color)) {
        materialCache.set(color, new THREE.MeshBasicMaterial({
            color: color,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        }));
    }
    return materialCache.get(color);
}

// ========== 訊號強度顏色映射 =========
function getColorForSignal(strength) {
    if (strength >= 90) return 0x00ff00; // 綠
    if (strength >= 70) return 0x7fff00; // 黃綠
    if (strength >= 50) return 0xffff00; // 黃
    if (strength >= 30) return 0xff7f00; // 橙
    if (strength >= 10) return 0xff0000; // 紅
    return 0x555555; // 灰(無訊號)
}

function getRadiusForSignal(strength) {
    if (strength >= 90) return 0.5;
    if (strength >= 70) return 0.4;
    if (strength >= 50) return 0.35;
    if (strength >= 30) return 0.3;
    if (strength >= 10) return 0.25;
    return 0; // 不顯示
}

// ========== 創建訊號視覺化 (AR 物體) ==========
const signalMeshes = [];

function createIndoorSignals() {
    INDOOR_SIGNAL_POINTS.forEach(point => {
        const color = getColorForSignal(point.power);
        const radius = getRadiusForSignal(point.power);

        if (radius === 0) return;

        // 創建圓形
        const geometry = new THREE.CircleGeometry(radius, 32);
        const material = getMaterialForColor(color);
        const mesh = new THREE.Mesh(geometry, material);

        // 設定位置 (在地面稍微上方)
        mesh.position.set(point.x, 0.1, point.z); // y=0.1 略高於地面

        // 水平放置 (朝上)
        mesh.rotation.x = -Math.PI / 2;

        // 儲存資料
        mesh.userData = {
            name: point.name,
            power: point.power,
            originalPosition: { x: point.x, y: 0.1, z: point.z }
        };

        scene.add(mesh);
        signalMeshes.push(mesh);

        console.log(`✅ 已創建訊號點: ${point.name} at (${point.x}, 0.1, ${point.z})`);
    });
}

// 初始化時創建所有訊號點
createIndoorSignals();

// ========== 步數偵測模組 ==========
class StepDetector {
    constructor() {
        this.lastMagnitude = 0;
        this.threshold = 11.25; // 加速度閾值 (需要根據實際情況調整)
        this.cooldown = 0;
        this.cooldownTime = 300; // 300ms 防抖動
        this.stepCount = 0;
        this.enabled = true;
    }

    update(acceleration, deltaTime) {
        // 更新冷卻時間
        this.cooldown = Math.max(0, this.cooldown - deltaTime);

        // 計算加速度大小
        const magnitude = Math.sqrt(
            acceleration.x ** 2 +
            acceleration.y ** 2 +
            acceleration.z ** 2
        );

        // 偵測上升邊緣 (從低到高)
        if (this.enabled &&
            magnitude > this.threshold && 
            this.lastMagnitude < this.threshold &&
            this.cooldown === 0) {

            this.stepCount++;
            this.cooldown = this.cooldownTime;
            this.lastMagnitude = magnitude;

            return true; // 偵測到一步
        }

        this.lastMagnitude = magnitude;
        return false;
    }

    reset() {
        this.stepCount = 0;
    }

    setEnabled(enabled) {
        this.enabled = enabled;
    }
}

// ========== 位置追蹤器 ==========
class IndoorPositionTracker {
    constructor(stepLength = 0.65) {
        this.position = { x: 0, y: 1.6, z: 0 }; // 初始位置
        this.stepLength = stepLength; // 每步距離 (公尺)
        this.stepDetector = new StepDetector();
        this.yaw = 0; // 水平方向角度
    }

    updateOrientation(orientationData, initialYaw) {
        // 從 deviceorientation 事件更新方向
        if (orientationData.alpha !== null && initialYaw !== null) {
            // 使用校準後的方向
            this.yaw = initialYaw - (orientationData.alpha * Math.PI / 180);
        }
    }

    update(accelerationData, deltaTime) {
        // 偵測步數
        const stepDetected = this.stepDetector.update(accelerationData, deltaTime);

        if (stepDetected) {
            // 計算前進方向 (基於當前 yaw)
            const forwardX = Math.sin(this.yaw);
            const forwardZ = -Math.cos(this.yaw);

            // 更新位置
            this.position.x += forwardX * this.stepLength;
            this.position.z += forwardZ * this.stepLength;

            console.log(`🚶 走了一步 (#${this.stepDetector.stepCount}) 位置: (${this.position.x.toFixed(2)}, ${this.position.z.toFixed(2)})`);

            // 紀錄當前的陀螺儀資訊
            console.log(`📡 陀螺儀數據 - Yaw: ${(this.yaw * 180 / Math.PI).toFixed(2)}°, 前進方向 X: ${forwardX.toFixed(3)}, Z: ${forwardZ.toFixed(3)}`);
            console.log(`   加速度 - X: ${accelerationData.x.toFixed(3)}, Y: ${accelerationData.y.toFixed(3)}, Z: ${accelerationData.z.toFixed(3)}`);

            return true; // 有移動
        }

        return false; // 沒有移動
    }

    reset() {
        this.position = { x: 0, y: 1.6, z: 0 };
        this.stepDetector.reset();
        console.log("🔄 已重設位置");
    }

    getPosition() {
        return this.position;
    }

    getStepCount() {
        return this.stepDetector.stepCount;
    }
}

// 創建追蹤器
const tracker = new IndoorPositionTracker(0.65); // 每步 0.65 公尺

// ========== 監聽感測器 ==========
let lastTime = Date.now();

// 監聽裝置方向
window.addEventListener('deviceorientation', (event) => {
    tracker.updateOrientation({
        alpha: event.alpha,
        beta: event.beta,
        gamma: event.gamma
    }, deviceOrientationControls.initialYaw); // 傳入初始 Yaw
});

// 監聽加速度計
window.addEventListener('devicemotion', (event) => {
    const now = Date.now();
    const dt = now - lastTime;
    lastTime = now;

    if (event.accelerationIncludingGravity) {
        const accel = {
            x: event.accelerationIncludingGravity.x || 0,
            y: event.accelerationIncludingGravity.y || 0,
            z: event.accelerationIncludingGravity.z || 0
        };

        // 更新位置
        const moved = tracker.update(accel, dt);

        if (moved) {
            // 更新相機位置
            const pos = tracker.getPosition();
            camera.position.x = pos.x;
            camera.position.z = pos.z;

            // 更新資訊面板
            updateInfoPanel();
        }
    }
});

// ========== 資訊面板更新 ==========
function updateInfoPanel() {
    const pos = tracker.getPosition();

    // 更新座標顯示
    document.getElementById('lon-value').textContent = pos.x.toFixed(2) + ' m';
    document.getElementById('lat-value').textContent = pos.z.toFixed(2) + ' m';
    document.getElementById('grid-point').textContent = `步數: ${tracker.getStepCount()}`;
    document.getElementById('grid-count').textContent = INDOOR_SIGNAL_POINTS.length;

    // 計算最近的訊號點
    let nearestPoint = null;
    let minDistance = Infinity;

    INDOOR_SIGNAL_POINTS.forEach(point => {
        const dx = pos.x - point.x;
        const dz = pos.z - point.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance < minDistance) {
            minDistance = distance;
            nearestPoint = point;
        }
    });

    if (nearestPoint) {
        // 更新訊號資訊
        const strengthElement = document.getElementById('signal-strength');
        strengthElement.textContent = nearestPoint.power.toFixed(1) + ' dBm';

        const color = getColorForSignal(nearestPoint.power);
        strengthElement.style.color = `#${color.toString(16).padStart(6, '0')}`;

        document.getElementById('nearest-station').textContent = nearestPoint.name;
        document.getElementById('station-distance').textContent = minDistance.toFixed(2) + ' m';
    }
}

// ========== 動畫循環 ==========
function animate() {
    deviceOrientationControls.update();

    ARRenderer.render(scene, camera);
    requestAnimationFrame(animate);
}

animate();

// ========== UI 控制 ==========

// 1. 初始化相機
async function initializeAllDevices() {
    console.log("🔐 初始化所有裝置...");
    
    try {
        const cameraOK = await initializeCamera();
        if (!cameraOK) {
            console.warn("⚠️ 相機初始化失敗");
        }
    } catch (err) {
        console.error("相機初始化異常:", err);
    }
    
    // 初始化陀螺儀控制器 (適用於 Android/其他)
    try {
        await deviceOrientationControls.init();
    } catch (err) {
        console.error("陀螺儀初始化異常:", err);
    }
}

// 2. 陀螺儀授權按鈕 (iOS 需要使用者手勢)
function initializeGyroPermissionButton() {
    const button = document.createElement('button');
    button.id = 'gyroPermissionButton';
    button.textContent = '啟用陀螺儀';
    button.style.cssText = `
        position: absolute;
        top: 10px;
        left: 10px;
        z-index: 1000;
        padding: 8px 16px;
        background-color: #4CAF50;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
    `;
    
    button.addEventListener('click', async () => {
        if (typeof DeviceOrientationEvent !== 'undefined' && 
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permission = await DeviceOrientationEvent.requestPermission();
                if (permission === 'granted') {
                    deviceOrientationControls.connect();
                    console.log("✅ 陀螺儀已授權 (iOS)");
                    alert('✅ 陀螺儀已啟用！');
                    button.remove();
                } else {
                    console.warn("⚠️ 使用者拒絕了陀螺儀授權");
                    alert("請允許陀螺儀授權以啟用完整功能。");
                }
            } catch (error) {
                console.error("❌ 陀螺儀授權失敗:", error);
                alert(`陀螺儀授權失敗: ${error.message || error}`);
            }
        } else {
            console.error("❌ 裝置不支援 DeviceOrientationEvent.requestPermission");
            alert("您的裝置或瀏覽器不支援陀螺儀授權功能。");
        }
    });
    
    document.body.appendChild(button);
}

// 3. 重設位置按鈕
function initializeResetButton() {
    const resetButton = document.getElementById('setFakeLoc');
    if (resetButton) {
        resetButton.addEventListener('click', () => {
            tracker.reset();
            camera.position.set(0, 1.6, 0);
            updateInfoPanel();
            alert('✅ 已重設到原點!');
        });
    }
}

// ========== 系統初始化 ==========
async function initializeSystem() {
    console.log("🚀 正在初始化室內 AR 系統...");
    
    // 初始化所有裝置
    await initializeAllDevices();
    
    // 初始化 UI 按鈕
    initializeGyroPermissionButton();
    initializeResetButton();
    
    // 初始更新資訊面板
    updateInfoPanel();
    
    // 記錄系統狀態
    console.log("✅ 室內 AR 系統已初始化");
    console.log(`📍 訊號點數量: ${INDOOR_SIGNAL_POINTS.length}`);
    console.log("🚶 開始走動以追蹤位置...");
    console.log("📱 提示: 如果是 iOS 設備，請點擊「啟用陀螺儀」按鈕以授權陀螺儀功能");
}

// 頁面加載後開始初始化
document.addEventListener('DOMContentLoaded', initializeSystem);
// 備用: 如果頁面已加載則立即初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSystem);
} else {
    initializeSystem();
}
