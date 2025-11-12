import * as THREE from "https://esm.sh/three";

// ╔════════════════════════════════════════════════════════════════╗
// ║           室內 AR 追蹤系統 - Indoor AR Tracking System          ║
// ╚════════════════════════════════════════════════════════════════╝

// ═══════════════════════════════════════════════════════════════
// 第 1 部分：Three.js 基礎設定
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// 第 2 部分：攝像頭管理
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// 第 3 部分：陀螺儀控制
// ═══════════════════════════════════════════════════════════════
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
            this.gamma = 0;
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
            0      // Z 軸
        );

        this.camera.quaternion.setFromEuler(this.euler);
    }
}

const deviceOrientationControls = new DeviceOrientationController(camera);

// ═══════════════════════════════════════════════════════════════
// 第 4 部分：視窗調整
// ═══════════════════════════════════════════════════════════════
window.addEventListener("resize", ev => {
    ARRenderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
});

// ═══════════════════════════════════════════════════════════════
// 第 5 部分：訊號點資料與視覺化
// ═══════════════════════════════════════════════════════════════
// x: 左右 (正=右), y: 上下 (正=上), z: 前後 (負=前方)
const INDOOR_SIGNAL_POINTS = [
    { x: 0, y: 0, z: -5, power: 90, name: "訊號點 A" },
    { x: -3, y: 0, z: 0, power: 5, name: "訊號點 B" },
    { x: -3, y: 0, z: -3, power: 30, name: "訊號點 C" },
    { x: 0, y: 0, z: -10, power: 50, name: "訊號點 D" },
    { x: 5, y: 0, z: -2, power: 70, name: "訊號點 E" },
    { x: -5, y: 0, z: -2, power: 10, name: "訊號點 F" }
];

// ═══════════════════════════════════════════════════════════════
// 第 6 部分：Material 快取 & 顏色映射
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// 第 7 部分：創建訊號視覺化
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// 第 8 部分：步數偵測模組 (進階版 - 峰值檢測 + 濾波器)
// ═══════════════════════════════════════════════════════════════
class StepDetector {
    constructor() {
        // 歷史數據緩衝區 (用於峰值檢測)
        this.magnitudeHistory = [];
        this.historySize = 10; // 保留最近 10 個樣本
        
        // === 低通濾波器 (指數移動平均 EMA) ===
        this.useFilter = true; // 是否啟用濾波器
        this.filterAlpha = 0.5; // 平滑係數 (0-1, 越小越平滑)
        this.filteredMagnitude = 9.8; // 濾波後的加速度 (初始為重力)
        this.rawMagnitudeHistory = []; // 保留原始數據用於比較
        
        // 動態閾值參數
        this.baseThreshold = 10.5; // 基礎閾值
        this.dynamicThreshold = 10.5; // 動態調整的閾值
        this.avgMagnitude = 9.8; // 移動平均值 (初始為重力加速度)
        this.magnitudeStdDev = 1.0; // 標準差
        
        // 峰值檢測參數
        this.lastPeakTime = 0;
        this.minPeakInterval = 500; // 最小峰值間隔 (ms) - 防止過快偵測
        
        // 步態分析
        this.lastMagnitude = 0;
        this.lastDelta = 0; // 上一次的變化率
        this.stepCount = 0;
        this.enabled = true;
        
        // 統計數據
        this.totalSamples = 0;
        this.falsePositiveFilter = false; // 啟用假陽性過濾
        
        console.log("🎯 進階步數偵測器已啟動 (含低通濾波器)");
        console.log(`   濾波器: ${this.useFilter ? '啟用' : '停用'}, α=${this.filterAlpha}`);
        console.log(`   基礎閾值: ${this.baseThreshold}, 最短峰值間隔: ${this.minPeakInterval}ms`);
    }

    update(acceleration, deltaTime) {
        if (!this.enabled) return false;

        // 計算原始加速度向量大小
        const rawMagnitude = Math.sqrt(
            acceleration.x ** 2 +
            acceleration.y ** 2 +
            acceleration.z ** 2
        );

        // === 低通濾波器 (指數移動平均 EMA) ===
        let magnitude;
        if (this.useFilter) {
            // EMA 公式: filtered = α × raw + (1-α) × previous_filtered
            this.filteredMagnitude = this.filterAlpha * rawMagnitude + 
                                     (1 - this.filterAlpha) * this.filteredMagnitude;
            magnitude = this.filteredMagnitude;
            
            // 保留原始數據用於除錯
            this.rawMagnitudeHistory.push(rawMagnitude);
            if (this.rawMagnitudeHistory.length > 5) {
                this.rawMagnitudeHistory.shift();
            }
        } else {
            magnitude = rawMagnitude;
        }

        // 更新歷史緩衝區 (使用濾波後的數據)
        this.magnitudeHistory.push(magnitude);
        if (this.magnitudeHistory.length > this.historySize) {
            this.magnitudeHistory.shift();
        }

        this.totalSamples++;

        // 需要至少 5 個樣本才開始檢測
        if (this.magnitudeHistory.length < 5) {
            this.lastMagnitude = magnitude;
            return false;
        }

        // === 1. 計算移動平均和標準差 (動態閾值) ===
        if (this.totalSamples % 10 === 0) { // 每 10 個樣本更新一次
            this.avgMagnitude = this.magnitudeHistory.reduce((a, b) => a + b, 0) / this.magnitudeHistory.length;
            
            const variance = this.magnitudeHistory.reduce((sum, val) => {
                return sum + Math.pow(val - this.avgMagnitude, 2);
            }, 0) / this.magnitudeHistory.length;
            
            this.magnitudeStdDev = Math.sqrt(variance);
            
            // 動態調整閾值 = 平均值 + 1 * 標準差
            this.dynamicThreshold = Math.max(
                this.baseThreshold, 
                this.avgMagnitude + 1 * this.magnitudeStdDev
            );
        }

        // === 2. 計算加速度變化率 (一階導數) ===
        const delta = magnitude - this.lastMagnitude;
        
        // === 3. 峰值檢測 ===
        // 條件：
        // - 當前加速度超過動態閾值
        // - 變化率從正變負 (峰值頂點)
        // - 變化率的變化足夠大 (避免平緩波動)
        const isPeak = magnitude > this.dynamicThreshold && 
                       this.lastDelta > 0 && 
                       delta < 0 &&
                       Math.abs(this.lastDelta) > 0.25; // 變化率閾值

        const currentTime = Date.now();
        const timeSinceLastPeak = currentTime - this.lastPeakTime;

        // === 4. 時間窗口驗證 ===
        if (isPeak && timeSinceLastPeak > this.minPeakInterval) {
            
            // === 5. 假陽性過濾 ===
            let isValidStep = true;
            
            if (this.falsePositiveFilter) {
                // 檢查峰值是否顯著高於最近的最小值
                const recentMin = Math.min(...this.magnitudeHistory);
                const peakProminence = magnitude - recentMin;
                
                // 峰值突出度必須 > 標準差 * 1.5
                if (peakProminence < this.magnitudeStdDev * 1.5) {
                    isValidStep = false;
                }
            }

            if (isValidStep) {
                this.stepCount++;
                this.lastPeakTime = currentTime;
                this.lastMagnitude = magnitude;
                this.lastDelta = delta;
                
                // 詳細日誌
                console.log(`🚶 偵測到步伐 #${this.stepCount}`);
                if (this.useFilter) {
                    console.log(`   原始: ${rawMagnitude.toFixed(2)}, 濾波: ${magnitude.toFixed(2)} (閾值: ${this.dynamicThreshold.toFixed(2)})`);
                } else {
                    console.log(`   加速度: ${magnitude.toFixed(2)} (閾值: ${this.dynamicThreshold.toFixed(2)})`);
                }
                console.log(`   峰值突出度: ${(magnitude - Math.min(...this.magnitudeHistory)).toFixed(2)}`);
                console.log(`   間隔時間: ${timeSinceLastPeak}ms`);
                
                return true; // 偵測到有效的一步
            }
        }

        // 更新狀態
        this.lastMagnitude = magnitude;
        this.lastDelta = delta;
        
        return false;
    }

    reset() {
        this.stepCount = 0;
        this.magnitudeHistory = [];
        this.rawMagnitudeHistory = [];
        this.lastPeakTime = 0;
        this.totalSamples = 0;
        this.avgMagnitude = 9.8;
        this.filteredMagnitude = 9.8;
        this.dynamicThreshold = this.baseThreshold;
        console.log("🔄 步數偵測器已重設");
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(`🎯 步數偵測: ${enabled ? '啟用' : '停用'}`);
    }
    
    // 啟用/停用濾波器
    setFilter(enabled, alpha = 0.5) {
        this.useFilter = enabled;
        this.filterAlpha = Math.max(0.1, Math.min(1.0, alpha)); // 限制在 0.1-1.0
        console.log(`🔧 濾波器: ${enabled ? '啟用' : '停用'}, α=${this.filterAlpha}`);
        if (enabled) {
            console.log(`   提示: α 越小越平滑 (建議範圍 0.2-0.5)`);
        }
    }
    
    // 調整靈敏度
    setSensitivity(level) {
        // level: 'low' (1.0), 'medium' (1.5), 'high' (2.0)
        const multipliers = {
            'low': 1.0,
            'medium': 1.5,
            'high': 2.0
        };
        
        const multiplier = multipliers[level] || 1.5;
        this.baseThreshold = 11 / multiplier;
        console.log(`🎚️ 靈敏度設為 ${level}, 基礎閾值: ${this.baseThreshold.toFixed(2)}`);
    }
    
    // 獲取統計資訊
    getStats() {
        return {
            stepCount: this.stepCount,
            avgMagnitude: this.avgMagnitude.toFixed(2),
            filteredMagnitude: this.filteredMagnitude.toFixed(2),
            dynamicThreshold: this.dynamicThreshold.toFixed(2),
            stdDev: this.magnitudeStdDev.toFixed(2),
            samples: this.totalSamples,
            filterEnabled: this.useFilter,
            filterAlpha: this.filterAlpha
        };
    }
}

// ═══════════════════════════════════════════════════════════════
// 第 9 部分：位置追蹤器
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// 第 10 部分：感測器事件監聽
// ═══════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════
// 第 11 部分：資訊面板更新
// ═══════════════════════════════════════════════════════════════
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

    // 訊號資訊已隱藏，不需要更新
    // if (nearestPoint) {
    //     const strengthElement = document.getElementById('signal-strength');
    //     strengthElement.textContent = nearestPoint.power.toFixed(1) + ' dBm';
    //     ...
    // }
}

// ═══════════════════════════════════════════════════════════════
// 第 12 部分：動畫循環
// ═══════════════════════════════════════════════════════════════
function animate() {
    deviceOrientationControls.update();

    ARRenderer.render(scene, camera);
    requestAnimationFrame(animate);
}

animate();

// ═══════════════════════════════════════════════════════════════
// 第 13 部分：UI 初始化函數
// ═══════════════════════════════════════════════════════════════
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

// 陀螺儀授權按鈕 (iOS 需要使用者手勢)
function initializeGyroPermissionButton() {
    // 檢查按鈕是否已存在，避免重複建立
    if (document.getElementById('gyroPermissionButton')) {
        console.log("⚠️ 陀螺儀按鈕已存在，跳過建立");
        return;
    }

    const button = document.createElement('button');
    button.id = 'gyroPermissionButton';
    button.textContent = '📱 啟用陀螺儀與相機';
    button.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        z-index: 10000;
        padding: 20px 40px;
        background-color: #007AFF;
        color: white;
        border: none;
        border-radius: 12px;
        cursor: pointer;
        font-size: 18px;
        font-weight: bold;
        box-shadow: 0 4px 12px rgba(0, 122, 255, 0.5);
    `;

    button.addEventListener('click', async () => {
        button.textContent = '⏳ 載入中...';
        button.disabled = true;

        if (typeof DeviceOrientationEvent !== 'undefined' && 
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            try {
                const permission = await DeviceOrientationEvent.requestPermission();
                if (permission === 'granted') {
                    deviceOrientationControls.connect();
                    console.log("✅ 陀螺儀已授權 (iOS)");

                    // 等待相機初始化完成後再移除按鈕
                    await initializeAllDevices();

                    // 延遲一下確保所有初始化完成
                    setTimeout(() => {
                        if (button.parentNode) {
                            button.remove();
                        }
                        console.log("✅ 按鈕已移除，系統準備就緒");
                    }, 500);
                } else {
                    console.warn("⚠️ 使用者拒絕了陀螺儀授權");
                    button.textContent = '❌ 拒絕授權，請重試';
                    button.disabled = false;
                }
            } catch (error) {
                console.error("❌ 陀螺儀授權失敗:", error);
                button.textContent = '❌ 授權失敗，請重試';
                button.disabled = false;
            }
        } else {
            // Android 或不需要授權的裝置
            console.log("✅ 裝置不需要授權程序，直接啟用");
            deviceOrientationControls.connect();

            // 等待相機初始化完成後再移除按鈕
            await initializeAllDevices();

            setTimeout(() => {
                if (button.parentNode) {
                    button.remove();
                }
                console.log("✅ 按鈕已移除，系統準備就緒");
            }, 500);
        }
    });

    document.body.appendChild(button);
}

// 重設位置按鈕
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

// ═══════════════════════════════════════════════════════════════
// 設定面板初始化
// ═══════════════════════════════════════════════════════════════
function initializeSettingsPanel() {
    // 濾波器 α 值滑桿
    const filterAlphaSlider = document.getElementById('filter-alpha');
    const filterAlphaValue = document.getElementById('filter-alpha-value');
    
    if (filterAlphaSlider) {
        filterAlphaSlider.addEventListener('input', (e) => {
            const alpha = parseFloat(e.target.value);
            tracker.stepDetector.setFilter(true, alpha);
            filterAlphaValue.textContent = alpha.toFixed(1);
        });
    }
    
    // 靈敏度下拉選單
    const sensitivitySelect = document.getElementById('sensitivity');
    if (sensitivitySelect) {
        sensitivitySelect.addEventListener('change', (e) => {
            const level = e.target.value;
            tracker.stepDetector.setSensitivity(level);
        });
    }
    
    console.log("⚙️ 設定面板已初始化");
}

// ═══════════════════════════════════════════════════════════════
// 第 14 部分：系統初始化入口
// ═══════════════════════════════════════════════════════════════
async function initializeSystem() {
    console.log("🚀 正在初始化室內 AR 系統...");

    // 1. 先顯示陀螺儀授權按鈕 (iOS 需要使用者手勢)
    initializeGyroPermissionButton();

    // 2. 初始化重設按鈕 (先做，不需要等待)
    initializeResetButton();
    
    // 3. 初始化設定面板
    initializeSettingsPanel();

    // 4. 配置步數偵測器參數
    tracker.stepDetector.setFilter(true, 0.5);      // 啟用濾波器，α=0.5 (中等平滑)
    tracker.stepDetector.setSensitivity('medium');  // 設置中等靈敏度
    console.log("⚙️ 步數偵測器已配置 - 濾波器: 啟用 (α=0.5), 靈敏度: 中等");

    // 5. 初始更新資訊面板
    updateInfoPanel();

    // 6. 記錄系統狀態
    console.log("✅ 室內 AR 系統框架已初始化，等待使用者授權...");
    console.log(`📍 訊號點數量: ${INDOOR_SIGNAL_POINTS.length}`);
    console.log("🚶 授權後開始走動以追蹤位置...");
    console.log("💡 提示: 可在瀏覽器控制台使用以下命令調整參數:");
    console.log("   tracker.stepDetector.setFilter(true, 0.2)   // α越小越平滑");
    console.log("   tracker.stepDetector.setSensitivity('high') // 調整靈敏度");
}

// 頁面加載後開始初始化
document.addEventListener('DOMContentLoaded', initializeSystem);
// 備用: 如果頁面已加載則立即初始化
// 頁面加載後開始初始化 (確保只執行一次)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSystem);
    document.addEventListener('DOMContentLoaded', initializeSystem, { once: true });
} else {
    // 頁面已加載，立即執行
    initializeSystem();
}
