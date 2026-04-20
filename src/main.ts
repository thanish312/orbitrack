import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import GUI from 'lil-gui';
import * as satellite from 'satellite.js';
import './style.css';
import {
  CelestrakClient,
  PRESET_SATELLITES,
  SATELLITE_GROUPS,
  type CelestrakOmm,
} from './api/celestrak';
import {
  WGS84_A,
  WGS84_B,
  circularVelocityAtAltitude,
  computeTelemetry,
  createDeploymentState,
  formatDateUtc,
  formatDistance,
  formatLatitude,
  formatLongitude,
  formatPeriod,
  formatSpeed,
  propagateState,
  toScenePosition,
  type DeploymentState,
  type OrbitalTelemetry,
  type UnitSystem,
} from './orbit';

type TrackingMode = 'tracked' | 'custom';
type SatelliteVisualKind = 'station' | 'telescope' | 'cubesat' | 'geo' | 'navigation' | 'rocket' | 'debris' | 'custom' | 'default';

interface UiRefs {
  // Telemetry readout (right inspector panel)
  altValue: HTMLElement;
  speedValue: HTMLElement;
  periodValue: HTMLElement;
  orbitDetails: HTMLElement;
  groundPos: HTMLElement;
  stateValue: HTMLElement;
  apsesValue: HTMLElement;
  
  // Dock cards (bottom telemetry)
  dockAlt: HTMLElement;
  dockSpeed: HTMLElement;
  dockPeriod: HTMLElement;
  dockIncl: HTMLElement;
  dockGround: HTMLElement;
  simTime: HTMLElement;
  
  // Status and badges
  statusBanner: HTMLElement;
  unitBadge: HTMLElement;
  targetName: HTMLElement;
  
  // Left rail: Discovery
  presetSelect: HTMLSelectElement;
  loadPresetSatellite: HTMLButtonElement;
  groupSelect: HTMLSelectElement;
  groupSatelliteSelect: HTMLSelectElement;
  groupStatus: HTMLElement;
  searchInput: HTMLInputElement;
  searchButton: HTMLButtonElement;
  searchResults: HTMLSelectElement;
  loadSearchResult: HTMLButtonElement;
  loadGroupSatellite: HTMLButtonElement;
  
  // Right inspector: Deployment
  deployAltitude: HTMLInputElement;
  deploySpeed: HTMLInputElement;
  deployInclination: HTMLInputElement;
  deployFpa: HTMLInputElement;
  setCircularSpeed: HTMLButtonElement;
  deployCustom: HTMLButtonElement;
  
  // Right inspector: Actions
  clearTrails: HTMLButtonElement;
  resetView: HTMLButtonElement;
  
  // Object details
  objName: HTMLElement;
  objId: HTMLElement;
  objEpoch: HTMLElement;
  
  // Simulation controls (from GUI, but stored for reference)
  pausedToggle: HTMLInputElement;
  followToggle: HTMLInputElement;
  imperialToggle: HTMLInputElement;
  timeScale: HTMLInputElement;
  timeScaleDisplay: HTMLElement;
  timeScaleInput: HTMLInputElement;
}

interface TrackedSatellite {
  record: satellite.SatRec;
  sourceUrl: string;
  omm: CelestrakOmm;
}

class OrbitalSimulatorApp {
  private readonly client = new CelestrakClient();
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });

  private readonly LAYOUT = {
    leftRailWidth: 280,
    rightInspectorWidth: 320,
    topBarHeight: 60,
    bottomDockHeight: 80,
  };

  private getCanvasWidth(): number {
    return window.innerWidth - this.LAYOUT.leftRailWidth - this.LAYOUT.rightInspectorWidth;
  }

  private getCanvasHeight(): number {
    return window.innerHeight - this.LAYOUT.topBarHeight - this.LAYOUT.bottomDockHeight;
  }

  private getCanvasAspect(): number {
    return this.getCanvasWidth() / this.getCanvasHeight();
  }
  private readonly controls: OrbitControls;
  private readonly gui = new GUI({ title: 'Flight Controls' });
  private readonly clock = new THREE.Clock();
  private readonly followOffset = new THREE.Vector3(9, 5, 7);

  private readonly earthMesh: THREE.Mesh;
  private readonly nightLightsMesh: THREE.Mesh;
  private readonly cloudMesh: THREE.Mesh;
  private readonly atmosphereMesh: THREE.Mesh;
  private readonly satelliteGroup = new THREE.Group();
  private readonly orbitTrail: THREE.Line;
  private readonly groundTrail: THREE.Line;
  private readonly nadirLine: THREE.Line;
  private readonly groundMarker: THREE.Mesh;
  private readonly ui: UiRefs;

  private readonly deployment = {
    altitudeKm: 420,
    speedKmS: circularVelocityAtAltitude(420),
    inclinationDeg: 51.6,
    flightPathAngleDeg: 0,
  };

  private trackingMode: TrackingMode = 'tracked';
  private trackedSatellite: TrackedSatellite | null = null;
  private deployedState = createDeploymentState(
    this.deployment.altitudeKm,
    this.deployment.speedKmS,
    this.deployment.inclinationDeg,
    this.deployment.flightPathAngleDeg,
  );
  private simulationTime = new Date();
  private activeGroupResults: CelestrakOmm[] = [];
  private latestOrbitPoints: THREE.Vector3[] = [];
  private latestGroundPoints: THREE.Vector3[] = [];
  private currentVisualKind: SatelliteVisualKind | null = null;

  private readonly settings = {
    paused: false,
    followSatellite: false,
    showImperial: false,
    useDrag: true,
    timeScale: 120,
    accelerateTrackedSatellites: false,
    clearTrails: () => this.resetTrails(),
    resetView: () => this.resetCamera(),
    syncTracked: async () => {
      if (this.trackedSatellite) {
        await this.loadCatalogNumber(this.trackedSatellite.omm.NORAD_CAT_ID);
      }
    },
    setCircularSpeed: () => {
      this.deployment.speedKmS = circularVelocityAtAltitude(this.deployment.altitudeKm);
      this.deployFromInputs();
      this.refreshGui();
    },
    deployCustom: () => this.deployFromInputs(),
  };

  constructor() {
    // Initialize camera with correct aspect ratio for constrained canvas
    this.camera = new THREE.PerspectiveCamera(42, this.getCanvasAspect(), 0.01, 200000);

    this.ui = this.captureUi();

    // Sync UI with initial values
    this.ui.deployAltitude.value = this.deployment.altitudeKm.toString();
    this.ui.deploySpeed.value = this.deployment.speedKmS.toString();
    this.ui.deployInclination.value = this.deployment.inclinationDeg.toString();
    this.ui.deployFpa.value = this.deployment.flightPathAngleDeg.toString();
    this.ui.pausedToggle.checked = this.settings.paused;
    this.ui.followToggle.checked = this.settings.followSatellite;
    this.ui.imperialToggle.checked = this.settings.showImperial;
    this.ui.timeScale.value = this.settings.timeScale.toString();

    this.camera.position.set(15, 10, 18);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.getCanvasWidth(), this.getCanvasHeight());
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.domElement.setAttribute('aria-label', 'Orbital mission console canvas');
    requiredElement<HTMLDivElement>('app').appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxDistance = 55;
    this.controls.minDistance = 5;

    this.scene.fog = new THREE.FogExp2(0x020611, 0.025);

    this.earthMesh = this.createEarth();
    this.nightLightsMesh = this.createNightLights();
    this.cloudMesh = this.createCloudLayer();
    this.atmosphereMesh = this.createAtmosphere();
    this.groundMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.09, 48),
      new THREE.MeshBasicMaterial({ color: 0xff7b54, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }),
    );
    this.nadirLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffb36c, transparent: true, opacity: 0.7 }));
    this.orbitTrail = this.createTrail(0x72f1ff, 0.85);
    this.groundTrail = this.createTrail(0xffcf70, 0.85);

    this.buildScene();
    this.populateSelectors();
    this.bindUi();
    this.setupGui();
    this.resetCamera();

    void this.loadCatalogNumber(PRESET_SATELLITES[0].catalogNumber);

    this.clock.start();
    this.renderer.setAnimationLoop(() => this.animate());
    window.addEventListener('resize', this.handleResize);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private captureUi(): UiRefs {
    return {
      // Telemetry readout (right inspector panel)
      altValue: requiredElement('alt-value'),
      speedValue: requiredElement('speed-value'),
      periodValue: requiredElement('period-value'),
      orbitDetails: requiredElement('orbit-details'),
      groundPos: requiredElement('ground-pos'),
      stateValue: requiredElement('state-value'),
      apsesValue: requiredElement('apses-value'),
      
      // Dock cards (bottom telemetry)
      dockAlt: requiredElement('dock-alt'),
      dockSpeed: requiredElement('dock-speed'),
      dockPeriod: requiredElement('dock-period'),
      dockIncl: requiredElement('dock-incl'),
      dockGround: requiredElement('dock-ground'),
      simTime: requiredElement('sim-time'),
      
      // Status and badges
      statusBanner: requiredElement('status-banner'),
      unitBadge: requiredElement('unit-badge'),
      targetName: requiredElement('target-name'),
      
      // Left rail: Discovery
      presetSelect: requiredElement('preset-select'),
      loadPresetSatellite: requiredElement('load-preset-satellite'),
      groupSelect: requiredElement('group-select'),
      groupSatelliteSelect: requiredElement('group-satellite-select'),
      groupStatus: requiredElement('group-status'),
      searchInput: requiredElement('search-input'),
      searchButton: requiredElement('search-button'),
      searchResults: requiredElement('search-results'),
      loadSearchResult: requiredElement('load-search-result'),
      loadGroupSatellite: requiredElement('load-group-satellite'),
      
      // Right inspector: Deployment
      deployAltitude: requiredElement('deploy-altitude'),
      deploySpeed: requiredElement('deploy-speed'),
      deployInclination: requiredElement('deploy-inclination'),
      deployFpa: requiredElement('deploy-fpa'),
      setCircularSpeed: requiredElement('set-circular-speed'),
      deployCustom: requiredElement('deploy-custom'),
      
      // Right inspector: Actions
      clearTrails: requiredElement('clear-trails'),
      resetView: requiredElement('reset-view'),
      
      // Object details
      objName: requiredElement('obj-name'),
      objId: requiredElement('obj-id'),
      objEpoch: requiredElement('obj-epoch'),
      
      // Simulation controls (from GUI)
      pausedToggle: requiredElement('paused-toggle'),
      followToggle: requiredElement('follow-toggle'),
      imperialToggle: requiredElement('imperial-toggle'),
      timeScale: requiredElement('time-scale'),
      timeScaleDisplay: requiredElement('time-scale-display'),
      timeScaleInput: requiredElement('time-scale-input'),
    };
  }

  private buildScene(): void {
    this.scene.add(new THREE.AmbientLight(0x6b90b4, 1.15));
    this.scene.add(new THREE.HemisphereLight(0xb9dcff, 0x12243b, 1.8));

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(14, 10, 8);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x8fc7ff, 1.1);
    fillLight.position.set(-12, -4, -10);
    this.scene.add(fillLight);

    this.scene.add(this.createStarField());
    this.scene.add(this.earthMesh);
    this.scene.add(this.nightLightsMesh);
    this.scene.add(this.cloudMesh);
    this.scene.add(this.atmosphereMesh);
    this.scene.add(this.createGraticule());
    this.scene.add(this.createPrimeMeridianMarker());

    this.updateSatelliteVisual('station');
    this.scene.add(this.satelliteGroup);
    this.scene.add(this.orbitTrail);
    this.scene.add(this.groundTrail);
    this.scene.add(this.nadirLine);
    this.scene.add(this.groundMarker);
  }

  private createEarth(): THREE.Mesh {
    const loader = new THREE.TextureLoader();
    const anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const earthTexture = loader.load('https://cdn.jsdelivr.net/gh/vasturiano/three-globe/example/img/earth-blue-marble.jpg');
    earthTexture.colorSpace = THREE.SRGBColorSpace;
    earthTexture.anisotropy = anisotropy;

    const bumpTexture = loader.load('https://cdn.jsdelivr.net/gh/vasturiano/three-globe/example/img/earth-topology.png');
    const normalTexture = loader.load('https://threejs.org/examples/textures/planets/earth_normal_2048.jpg');
    normalTexture.anisotropy = anisotropy;
    const geometry = new THREE.SphereGeometry(WGS84_A * 0.001, 128, 128);
    geometry.scale(1, WGS84_B / WGS84_A, 1);

    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x123556,
      emissiveIntensity: 0.42,
      map: earthTexture,
      bumpMap: bumpTexture,
      bumpScale: 0.1,
      normalMap: normalTexture,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughness: 0.82,
      metalness: 0.02,
    });

    return new THREE.Mesh(geometry, material);
  }

  private createNightLights(): THREE.Mesh {
    const loader = new THREE.TextureLoader();
    const lightsTexture = loader.load('https://threejs.org/examples/textures/planets/earth_lights_2048.png');
    lightsTexture.colorSpace = THREE.SRGBColorSpace;
    lightsTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    const geometry = new THREE.SphereGeometry((WGS84_A + 2) * 0.001, 128, 128);
    geometry.scale(1, WGS84_B / WGS84_A, 1);

    return new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: lightsTexture,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
  }

  private createCloudLayer(): THREE.Mesh {
    const loader = new THREE.TextureLoader();
    const cloudsTexture = loader.load('https://cdn.jsdelivr.net/gh/vasturiano/three-globe/example/img/earth-clouds.png');
    cloudsTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const geometry = new THREE.SphereGeometry((WGS84_A + 18) * 0.001, 96, 96);
    geometry.scale(1, WGS84_B / WGS84_A, 1);
    const material = new THREE.MeshStandardMaterial({
      alphaMap: cloudsTexture,
      color: 0xc7f6ff,
      transparent: true,
      depthWrite: false,
      opacity: 0.28,
    });
    return new THREE.Mesh(geometry, material);
  }

  private createAtmosphere(): THREE.Mesh {
    const geometry = new THREE.SphereGeometry((WGS84_A + 54) * 0.001, 96, 96);
    geometry.scale(1, WGS84_B / WGS84_A, 1);
    return new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0x7cc8ff,
        transparent: true,
        opacity: 0.16,
        side: THREE.BackSide,
      }),
    );
  }

  private updateSatelliteVisual(kind: SatelliteVisualKind): void {
    if (this.currentVisualKind === kind) {
      return;
    }

    this.currentVisualKind = kind;
    this.satelliteGroup.clear();
    this.satelliteGroup.add(this.createSatelliteModel(kind));
  }

  private createSatelliteModel(kind: SatelliteVisualKind): THREE.Group {
    switch (kind) {
      case 'station':
        return this.createStationModel();
      case 'telescope':
        return this.createTelescopeModel();
      case 'cubesat':
        return this.createCubeSatModel();
      case 'geo':
        return this.createGeoBusModel();
      case 'navigation':
        return this.createNavigationModel();
      case 'rocket':
        return this.createRocketBodyModel();
      case 'debris':
        return this.createDebrisModel();
      case 'custom':
        return this.createCustomVehicleModel();
      default:
        return this.createDefaultSatelliteModel();
    }
  }

  private createDefaultSatelliteModel(): THREE.Group {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xd7dde8, metalness: 0.55, roughness: 0.48 });
    const goldMaterial = new THREE.MeshStandardMaterial({ color: 0xefb16a, metalness: 0.65, roughness: 0.38 });

    group.add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, 0.34), bodyMaterial));
    group.add(this.createSolarArray(0.72, 1.1, 0.32));
    group.add(this.createSolarArray(-0.72, 1.1, 0.32));

    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.28, 18), goldMaterial);
    antenna.rotation.z = Math.PI / 2;
    antenna.position.z = -0.22;
    group.add(antenna);

    const dish = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.05, 24, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xf8efe2, side: THREE.DoubleSide, metalness: 0.18, roughness: 0.52 }),
    );
    dish.rotation.x = -Math.PI / 2;
    dish.position.z = -0.36;
    group.add(dish);

    return group;
  }

  private createStationModel(): THREE.Group {
    const group = new THREE.Group();
    const moduleMaterial = new THREE.MeshStandardMaterial({ color: 0xd9e3ef, metalness: 0.42, roughness: 0.5 });
    const trussMaterial = new THREE.MeshStandardMaterial({ color: 0x7d8897, metalness: 0.3, roughness: 0.62 });

    const truss = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.08), trussMaterial);
    group.add(truss);

    for (const x of [-0.48, 0, 0.48]) {
      const module = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.38, 18), moduleMaterial);
      module.rotation.z = Math.PI / 2;
      module.position.x = x;
      group.add(module);
    }

    const node = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 20), moduleMaterial);
    group.add(node);

    group.add(this.createSolarArray(1.22, 1.45, 0.38));
    group.add(this.createSolarArray(-1.22, 1.45, 0.38));
    return group;
  }

  private createTelescopeModel(): THREE.Group {
    const group = new THREE.Group();
    const tubeMaterial = new THREE.MeshStandardMaterial({ color: 0xd2dae5, metalness: 0.55, roughness: 0.44 });
    const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x1b2a3f, metalness: 0.58, roughness: 0.4 });

    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.56, 24), tubeMaterial);
    tube.rotation.z = Math.PI / 2;
    group.add(tube);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 24), accentMaterial);
    cap.rotation.z = Math.PI / 2;
    cap.position.x = -0.28;
    group.add(cap);

    group.add(this.createSolarArray(0.62, 0.82, 0.26));
    group.add(this.createSolarArray(-0.62, 0.82, 0.26));
    return group;
  }

  private createCubeSatModel(): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.18, 0.18),
      new THREE.MeshStandardMaterial({ color: 0xdfe5ef, metalness: 0.4, roughness: 0.5 }),
    );
    group.add(body);
    group.add(this.createSolarArray(0.32, 0.44, 0.18));
    group.add(this.createSolarArray(-0.32, 0.44, 0.18));
    return group;
  }

  private createGeoBusModel(): THREE.Group {
    const group = new THREE.Group();
    const busMaterial = new THREE.MeshStandardMaterial({ color: 0xe0ccb3, metalness: 0.42, roughness: 0.48 });

    const bus = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.26, 0.34), busMaterial);
    group.add(bus);
    group.add(this.createSolarArray(0.9, 1.5, 0.28));
    group.add(this.createSolarArray(-0.9, 1.5, 0.28));

    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 24, 24, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0xf3ecdd, metalness: 0.12, roughness: 0.58 }),
    );
    dish.rotation.x = Math.PI;
    dish.position.z = -0.25;
    group.add(dish);
    return group;
  }

  private createNavigationModel(): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.22, 0.24),
      new THREE.MeshStandardMaterial({ color: 0xddd7c7, metalness: 0.38, roughness: 0.52 }),
    );
    group.add(body);

    for (const x of [-0.62, 0.62]) {
      const panel = this.createSolarArray(x, 0.74, 0.18);
      panel.rotation.z = THREE.MathUtils.degToRad(18);
      group.add(panel);
    }

    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 0.34, 16),
      new THREE.MeshStandardMaterial({ color: 0xe9b66e, metalness: 0.52, roughness: 0.36 }),
    );
    mast.position.y = 0.18;
    group.add(mast);
    return group;
  }

  private createRocketBodyModel(): THREE.Group {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xcdd2da, metalness: 0.28, roughness: 0.62 });

    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.7, 18), bodyMaterial);
    body.rotation.z = Math.PI / 2;
    group.add(body);

    const nozzle = new THREE.Mesh(
      new THREE.ConeGeometry(0.08, 0.12, 18),
      new THREE.MeshStandardMaterial({ color: 0x7d6a60, metalness: 0.28, roughness: 0.66 }),
    );
    nozzle.rotation.z = -Math.PI / 2;
    nozzle.position.x = 0.39;
    group.add(nozzle);
    return group;
  }

  private createDebrisModel(): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({ color: 0xbfc7d1, metalness: 0.2, roughness: 0.74 });

    const chunkA = new THREE.Mesh(new THREE.DodecahedronGeometry(0.12, 0), material);
    const chunkB = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.1), material);
    chunkB.position.set(0.16, 0.06, -0.04);
    chunkB.rotation.set(0.3, 0.7, 0.2);
    const chunkC = new THREE.Mesh(new THREE.TetrahedronGeometry(0.08, 0), material);
    chunkC.position.set(-0.14, -0.05, 0.08);

    group.add(chunkA, chunkB, chunkC);
    return group;
  }

  private createCustomVehicleModel(): THREE.Group {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.09, 0.34, 4, 12),
      new THREE.MeshStandardMaterial({ color: 0xe9edf5, metalness: 0.34, roughness: 0.46 }),
    );
    body.rotation.z = Math.PI / 2;
    group.add(body);
    group.add(this.createSolarArray(0.54, 0.72, 0.22));
    group.add(this.createSolarArray(-0.54, 0.72, 0.22));
    return group;
  }

  private createSolarArray(x: number, width: number, depth: number): THREE.Mesh {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.04, depth),
      new THREE.MeshStandardMaterial({
        color: 0x4b88ff,
        emissive: 0x163b7a,
        emissiveIntensity: 0.5,
        metalness: 0.35,
        roughness: 0.42,
      }),
    );
    panel.position.x = x;
    return panel;
  }

  private createTrail(color: number, opacity: number): THREE.Line {
    const geometry = new THREE.BufferGeometry();
    geometry.setFromPoints([new THREE.Vector3()]);
    return new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
    );
  }

  private createStarField(): THREE.Points {
    const geometry = new THREE.BufferGeometry();
    const count = 5000;
    const positions = new Float32Array(count * 3);

    for (let index = 0; index < count; index += 1) {
      const radius = 160 + Math.random() * 70;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = radius * Math.cos(phi);
      positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    return new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.35,
        transparent: true,
        opacity: 0.95,
        sizeAttenuation: true,
      }),
    );
  }

  private createGraticule(): THREE.Group {
    const group = new THREE.Group();
    const material = new THREE.LineBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0.18 });

    for (let latitude = -60; latitude <= 60; latitude += 30) {
      const points: THREE.Vector3[] = [];
      for (let longitude = 0; longitude <= 360; longitude += 5) {
        const latRad = THREE.MathUtils.degToRad(latitude);
        const lonRad = THREE.MathUtils.degToRad(longitude - 180);
        const ecf = satellite.geodeticToEcf({ latitude: latRad, longitude: lonRad, height: 0 });
        points.push(toScenePosition(ecf));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
    }

    for (let longitude = -180; longitude < 180; longitude += 30) {
      const points: THREE.Vector3[] = [];
      for (let latitude = -90; latitude <= 90; latitude += 4) {
        const latRad = THREE.MathUtils.degToRad(latitude);
        const lonRad = THREE.MathUtils.degToRad(longitude);
        const ecf = satellite.geodeticToEcf({ latitude: latRad, longitude: lonRad, height: 0 });
        points.push(toScenePosition(ecf));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
    }

    return group;
  }

  private createPrimeMeridianMarker(): THREE.Line {
    const points: THREE.Vector3[] = [];
    for (let latitude = -90; latitude <= 90; latitude += 3) {
      const ecf = satellite.geodeticToEcf({
        latitude: THREE.MathUtils.degToRad(latitude),
        longitude: 0,
        height: 0,
      });
      points.push(toScenePosition(ecf));
    }

    return new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0xff8462, transparent: true, opacity: 0.6 }),
    );
  }

  private inferTrackedVisual(omm: CelestrakOmm): SatelliteVisualKind {
    const name = (omm.OBJECT_NAME ?? '').toUpperCase();

    if (/(ISS|TIANHE|CSS|NAUKA|POISK|WENTIAN|MENGTIAN|PROGRESS|SOYUZ|CYGNUS|DRAGON|HTV)/.test(name)) {
      return 'station';
    }

    if (/(HUBBLE|TELESCOPE|OBSERVATORY|X-RAY|JWST)/.test(name)) {
      return 'telescope';
    }

    if (/(R\/B|FREGAT|STAGE|BOOSTER|UPPER|CZ-|PSLV|ATLAS|DELTA)/.test(name)) {
      return 'rocket';
    }

    if (/(DEB|DEBRIS|OBJECT|FRAGMENT)/.test(name)) {
      return 'debris';
    }

    if (/(GOES|INTELSAT|EUTELSAT|SES|TELESAT|TDRS|TDRSS|INMARSAT|ASIASAT)/.test(name)) {
      return 'geo';
    }

    if (/(GPS|GALILEO|GLONASS|BEIDOU|NAVSTAR|QZSS|IRNSS)/.test(name)) {
      return 'navigation';
    }

    if (/(STARLINK|ONEWEB|PLANET|SPIRE|CUBESAT|DOVE|LEMUR|SATNOGS)/.test(name)) {
      return 'cubesat';
    }

    return 'default';
  }

  private populateSelectors(): void {
    for (const preset of PRESET_SATELLITES) {
      this.ui.presetSelect.add(new Option(`${preset.label} (${preset.catalogNumber})`, String(preset.catalogNumber)));
    }

    this.ui.groupSelect.add(new Option('Select a CelesTrak group', ''));
    for (const group of SATELLITE_GROUPS) {
      this.ui.groupSelect.add(new Option(group.label, group.value));
    }
  }

  private bindUi(): void {
    // Discovery: Preset satellites
    this.ui.presetSelect.addEventListener('change', () => {
      this.setStatus(`Preset selected: ${this.ui.presetSelect.selectedOptions[0]?.text ?? 'Unknown object'}. Press "Track Preset Satellite" to load it.`);
    });

    this.ui.loadPresetSatellite.addEventListener('click', () => {
      const catalogNumber = Number(this.ui.presetSelect.value);
      if (Number.isFinite(catalogNumber)) {
        void this.loadCatalogNumber(catalogNumber);
      }
    });

    this.ui.groupSelect.addEventListener('change', () => {
      void this.loadSelectedGroup();
    });

    this.ui.loadGroupSatellite.addEventListener('click', () => {
      const selectedIndex = this.ui.groupSatelliteSelect.selectedIndex;
      const selected = this.activeGroupResults[selectedIndex];
      if (selected) {
        void this.trackFromOmm(selected, this.lookupGroupUrl());
      }
    });

    this.ui.searchButton.addEventListener('click', () => {
      void this.runSearch();
    });

    this.ui.searchInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.runSearch();
      }
    });

    this.ui.loadSearchResult.addEventListener('click', () => {
      const selectedIndex = this.ui.searchResults.selectedIndex;
      const option = this.ui.searchResults.options[selectedIndex];
      if (!option) {
        return;
      }

      const record = JSON.parse(option.dataset.omm ?? 'null') as CelestrakOmm | null;
      if (record) {
        void this.trackFromOmm(record, this.client.getQueryUrl({ NAME: this.ui.searchInput.value.trim() }));
      }
    });

    // Deploy tab bindings
    this.ui.deployAltitude.addEventListener('input', () => {
      this.deployment.altitudeKm = Number(this.ui.deployAltitude.value);
    });

    this.ui.deploySpeed.addEventListener('input', () => {
      this.deployment.speedKmS = Number(this.ui.deploySpeed.value);
    });

    this.ui.deployInclination.addEventListener('input', () => {
      this.deployment.inclinationDeg = Number(this.ui.deployInclination.value);
    });

    this.ui.deployFpa.addEventListener('input', () => {
      this.deployment.flightPathAngleDeg = Number(this.ui.deployFpa.value);
    });

    this.ui.setCircularSpeed.addEventListener('click', () => {
      this.deployment.speedKmS = circularVelocityAtAltitude(this.deployment.altitudeKm);
      this.ui.deploySpeed.value = this.deployment.speedKmS.toFixed(2);
      this.refreshGui();
    });

    this.ui.deployCustom.addEventListener('click', () => {
      this.deployFromInputs();
    });

    // Simulation controls
    this.ui.pausedToggle.addEventListener('change', () => {
      this.settings.paused = this.ui.pausedToggle.checked;
    });

    this.ui.followToggle.addEventListener('change', () => {
      this.settings.followSatellite = this.ui.followToggle.checked;
    });

    this.ui.imperialToggle.addEventListener('change', () => {
      this.settings.showImperial = this.ui.imperialToggle.checked;
      this.refreshTelemetry();
    });

    this.ui.timeScale.addEventListener('input', () => {
      this.settings.timeScale = Number(this.ui.timeScale.value);
      this.ui.timeScaleDisplay.textContent = `${this.settings.timeScale}×`;
      this.ui.timeScaleInput.value = String(this.settings.timeScale);
    });

    this.ui.timeScaleInput.addEventListener('input', () => {
      const value = Math.max(1, Math.min(1000, Number(this.ui.timeScaleInput.value) || 1));
      this.settings.timeScale = value;
      this.ui.timeScale.value = String(value);
      this.ui.timeScaleDisplay.textContent = `${value}×`;
      this.ui.timeScaleInput.value = String(value);
    });

    this.ui.timeScaleInput.addEventListener('blur', () => {
      const value = Math.max(1, Math.min(1000, Number(this.ui.timeScaleInput.value) || 1));
      this.settings.timeScale = value;
      this.ui.timeScale.value = String(value);
      this.ui.timeScaleDisplay.textContent = `${value}×`;
      this.ui.timeScaleInput.value = String(value);
    });

    this.ui.clearTrails.addEventListener('click', () => {
      this.resetTrails();
    });

    this.ui.resetView.addEventListener('click', () => {
      this.resetCamera();
    });
  }

  private setupGui(): void {
    const simulationFolder = this.gui.addFolder('Simulation');
    simulationFolder.add(this.settings, 'paused').name('Pause');
    simulationFolder.add(this.settings, 'timeScale', 1, 3600, 1).name('Time Scale');
    simulationFolder
      .add(this.settings, 'accelerateTrackedSatellites')
      .name('Accelerate Tracked')
      .onChange((enabled: boolean) => {
        this.simulationTime = new Date();
        this.setStatus(
          enabled
            ? 'Tracked satellites are now using simulator time scaling.'
            : 'Tracked satellites are back on real-time wall clock updates.',
        );
      });
    simulationFolder.add(this.settings, 'followSatellite').name('Follow Satellite');
    simulationFolder.add(this.settings, 'showImperial').name('Imperial Units');
    simulationFolder.add(this.settings, 'useDrag').name('Simple Drag');
    simulationFolder.add(this.settings, 'clearTrails').name('Clear Trails');
    simulationFolder.add(this.settings, 'resetView').name('Reset View');
    simulationFolder.open();

    const dataFolder = this.gui.addFolder('Tracking Data');
    dataFolder.add(this.settings, 'syncTracked').name('Refresh Selected');

    const deploymentFolder = this.gui.addFolder('Custom Deployment');
    deploymentFolder.add(this.deployment, 'altitudeKm', 160, 36000, 1).name('Altitude (km)');
    deploymentFolder.add(this.deployment, 'speedKmS', 0.1, 11.8, 0.001).name('Speed (km/s)');
    deploymentFolder.add(this.deployment, 'inclinationDeg', 0, 180, 0.1).name('Inclination (deg)');
    deploymentFolder.add(this.deployment, 'flightPathAngleDeg', -60, 60, 0.1).name('Flight Path (deg)');
    deploymentFolder.add(this.settings, 'setCircularSpeed').name('Set Circular Speed');
    deploymentFolder.add(this.settings, 'deployCustom').name('Deploy State');
  }

  private async loadCatalogNumber(catalogNumber: number): Promise<void> {
    this.setStatus(`Loading NORAD ${catalogNumber} from CelesTrak...`);
    try {
      const records = await this.client.fetchByCatalogNumber(catalogNumber);
      const record = records[0];
      if (!record) {
        throw new Error(`No GP data found for NORAD ${catalogNumber}`);
      }

      await this.trackFromOmm(record, this.client.getQueryUrl({ CATNR: String(catalogNumber) }));
      this.ui.presetSelect.value = String(catalogNumber);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Unable to load satellite.');
    }
  }

  private async loadSelectedGroup(): Promise<void> {
    const group = SATELLITE_GROUPS.find((entry) => entry.value === this.ui.groupSelect.value);
    if (!group) {
      return;
    }

    this.ui.groupStatus.textContent = group.caution ?? 'Loading group from CelesTrak...';
    this.ui.groupSatelliteSelect.innerHTML = '';
    this.activeGroupResults = [];

    try {
      const records = await this.client.fetchGroup(group);
      this.activeGroupResults = records;

      for (const record of records) {
        const label = `${record.OBJECT_NAME ?? `NORAD ${record.NORAD_CAT_ID}`} (${record.NORAD_CAT_ID})`;
        this.ui.groupSatelliteSelect.add(new Option(label, String(record.NORAD_CAT_ID)));
      }

      this.ui.groupStatus.textContent = `${records.length} objects loaded from ${group.label}.`;
      if (records[0]) {
        this.ui.groupSatelliteSelect.selectedIndex = 0;
      }
    } catch (error) {
      this.ui.groupStatus.textContent = error instanceof Error ? error.message : 'Unable to load group.';
    }
  }

  private async runSearch(): Promise<void> {
    const term = this.ui.searchInput.value.trim();
    if (!term) {
      this.setStatus('Enter a satellite name or NORAD catalog number.');
      return;
    }

    this.ui.searchResults.innerHTML = '';

    try {
      const results = /^\d+$/.test(term)
        ? await this.client.fetchByCatalogNumber(Number(term))
        : await this.client.searchByName(term);

      if (results.length === 0) {
        this.setStatus(`No CelesTrak results for "${term}".`);
        return;
      }

      for (const result of results.slice(0, 50)) {
        const label = `${result.OBJECT_NAME ?? `NORAD ${result.NORAD_CAT_ID}`} (${result.NORAD_CAT_ID})`;
        const option = new Option(label, String(result.NORAD_CAT_ID));
        option.dataset.omm = JSON.stringify(result);
        this.ui.searchResults.add(option);
      }

      this.ui.searchResults.selectedIndex = 0;
      this.setStatus(`Loaded ${Math.min(results.length, 50)} search result(s) from CelesTrak.`);
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : 'Search failed.');
    }
  }

  private async trackFromOmm(omm: CelestrakOmm, sourceUrl: string): Promise<void> {
    const [line1, line2] = await this.client.fetchTleLines(omm.NORAD_CAT_ID);
    const record = satellite.twoline2satrec(line1, line2);
    this.trackedSatellite = { record, sourceUrl, omm };
    this.trackingMode = 'tracked';
    this.updateSatelliteVisual(this.inferTrackedVisual(omm));
    this.simulationTime = new Date();
    this.resetTrails();

    const name = omm.OBJECT_NAME ?? `NORAD ${omm.NORAD_CAT_ID}`;
    this.setStatus(`Tracking ${name} from CelesTrak OMM JSON in real time.`);
    this.refreshTelemetry();
  }

  private deployFromInputs(): void {
    this.trackedSatellite = null;
    this.trackingMode = 'custom';
    this.updateSatelliteVisual('custom');
    this.simulationTime = new Date();
    this.deployedState = createDeploymentState(
      this.deployment.altitudeKm,
      this.deployment.speedKmS,
      this.deployment.inclinationDeg,
      this.deployment.flightPathAngleDeg,
    );
    this.resetTrails();
    this.setStatus('Custom inertial deployment active. Dynamics are propagated locally with RK4 + J2.');
  }

  private animate(): void {
    const frameDelta = Math.min(this.clock.getDelta(), 0.25);

    if (!this.settings.paused) {
      try {
        this.stepSimulation(frameDelta);
      } catch (error) {
        this.setStatus(error instanceof Error ? error.message : 'Simulation error.');
      }
    }

    if (this.settings.followSatellite) {
      this.controls.target.lerp(this.satelliteGroup.position, 0.12);
      const desiredPosition = this.satelliteGroup.position.clone().add(this.followOffset);
      this.camera.position.lerp(desiredPosition, 0.08);
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  private stepSimulation(frameDelta: number): void {
    const useScaledTrackedTime = this.trackingMode === 'tracked' && this.settings.accelerateTrackedSatellites;
    const simulationDelta =
      this.trackingMode === 'custom' || useScaledTrackedTime
        ? frameDelta * this.settings.timeScale
        : frameDelta;

    if (this.trackingMode === 'tracked' && !useScaledTrackedTime) {
      this.simulationTime = new Date();
    } else {
      this.simulationTime = new Date(this.simulationTime.getTime() + simulationDelta * 1000);
    }

    const gmst = satellite.gstime(this.simulationTime);
    const currentState = this.resolveCurrentState(simulationDelta);
    const positionEcf = satellite.eciToEcf(
      {
        x: currentState.positionEci.x,
        y: currentState.positionEci.y,
        z: currentState.positionEci.z,
      },
      gmst,
    );
    const telemetry = computeTelemetry(currentState.positionEci, currentState.velocityEci, gmst);

    const scenePosition = toScenePosition(positionEcf);
    const groundPosition = toScenePosition(telemetry.groundPointEcf);

    this.satelliteGroup.position.copy(scenePosition);
    this.satelliteGroup.lookAt(groundPosition);
    this.satelliteGroup.rotateX(Math.PI / 2);

    this.groundMarker.position.copy(groundPosition);
    this.groundMarker.lookAt(new THREE.Vector3(0, 0, 0));

    this.nadirLine.geometry.setFromPoints([scenePosition, groundPosition]);
    this.pushTrailPoint(this.latestOrbitPoints, scenePosition, this.orbitTrail, 1440);
    this.pushTrailPoint(this.latestGroundPoints, groundPosition, this.groundTrail, 2048);

    this.renderTelemetry(telemetry);
  }

  private resolveCurrentState(simulationDelta: number): DeploymentState {
    if (this.trackingMode === 'tracked' && this.trackedSatellite) {
      const propagated = satellite.propagate(this.trackedSatellite.record, this.simulationTime);
      if (
        !propagated ||
        typeof propagated.position === 'boolean' ||
        typeof propagated.velocity === 'boolean'
      ) {
        throw new Error('SGP4 propagation failed for the selected satellite.');
      }

      return {
        positionEci: new THREE.Vector3(propagated.position.x, propagated.position.y, propagated.position.z),
        velocityEci: new THREE.Vector3(propagated.velocity.x, propagated.velocity.y, propagated.velocity.z),
      };
    }

    const steps = Math.max(1, Math.ceil(simulationDelta / 30));
    const stepSize = simulationDelta / steps;
    let state = this.deployedState;

    for (let index = 0; index < steps; index += 1) {
      state = propagateState(state, stepSize, this.settings.useDrag);
    }

    this.deployedState = state;
    return state;
  }

  private renderTelemetry(telemetry: OrbitalTelemetry): void {
    const unitSystem: UnitSystem = this.settings.showImperial ? 'imperial' : 'metric';
    const trackedName = this.trackedSatellite?.omm.OBJECT_NAME ?? 'Custom state vector';
    const trackedId = this.trackedSatellite?.omm.NORAD_CAT_ID;
    const epoch = this.trackedSatellite?.omm.EPOCH;

    // Right inspector: Object Details
    this.ui.objName.textContent = trackedName;
    this.ui.objId.textContent = trackedId ? `NORAD ID: ${trackedId}` : 'NORAD ID: --';
    this.ui.objEpoch.textContent = epoch ? `Epoch: ${epoch}` : 'Epoch: --';

    // Right inspector: Orbital Elements
    this.ui.altValue.textContent = formatDistance(telemetry.altitudeKm, unitSystem);
    this.ui.speedValue.textContent = formatSpeed(telemetry.speedKmS, unitSystem);
    this.ui.periodValue.textContent = formatPeriod(telemetry.orbitalPeriodMinutes);
    this.ui.orbitDetails.textContent = `${telemetry.inclinationDeg.toFixed(2)}° / ${telemetry.eccentricity.toFixed(6)}`;
    this.ui.groundPos.textContent = `${formatLatitude(telemetry.latitudeDeg)}, ${formatLongitude(telemetry.longitudeDeg)}`;
    this.ui.apsesValue.textContent = `${formatDistance(telemetry.apogeeKm, unitSystem)} / ${formatDistance(telemetry.perigeeKm, unitSystem)}`;

    // Bottom telemetry dock: Live Cards
    this.ui.dockAlt.textContent = formatDistance(telemetry.altitudeKm, unitSystem);
    this.ui.dockSpeed.textContent = formatSpeed(telemetry.speedKmS, unitSystem);
    this.ui.dockPeriod.textContent = formatPeriod(telemetry.orbitalPeriodMinutes);
    this.ui.dockIncl.textContent = `${telemetry.inclinationDeg.toFixed(2)}°`;
    this.ui.dockGround.textContent = `${formatLatitude(telemetry.latitudeDeg)}, ${formatLongitude(telemetry.longitudeDeg)}`;
    this.ui.simTime.textContent = formatDateUtc(this.simulationTime);

    // Top bar and status
    this.ui.targetName.textContent = trackedName;
    this.ui.unitBadge.textContent = unitSystem === 'metric' ? 'km/s' : 'mi/s';

    // Status message
    if (this.trackingMode === 'tracked' && trackedId && epoch) {
      this.ui.statusBanner.textContent = this.settings.accelerateTrackedSatellites
        ? `Tracking ${trackedName} (accelerated simulation)`
        : `Tracking ${trackedName} (real-time)`;
    } else {
      this.ui.statusBanner.textContent = `Tracking custom state vector (RK4 + J2 propagation)`;
    }
  }

  private refreshTelemetry(): void {
    this.ui.simTime.textContent = formatDateUtc(this.simulationTime);
  }

  private pushTrailPoint(points: THREE.Vector3[], point: THREE.Vector3, line: THREE.Line, limit: number): void {
    points.push(point.clone());
    if (points.length > limit) {
      points.shift();
    }

    line.geometry.setFromPoints(points);
  }

  private resetTrails(): void {
    this.latestOrbitPoints = [];
    this.latestGroundPoints = [];
    this.orbitTrail.geometry.setFromPoints([new THREE.Vector3()]);
    this.groundTrail.geometry.setFromPoints([new THREE.Vector3()]);
    this.nadirLine.geometry.setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  }

  private resetCamera(): void {
    this.camera.position.set(15, 10, 18);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  private setStatus(message: string): void {
    this.ui.statusBanner.textContent = message;
  }

  private lookupGroupUrl(): string {
    const group = SATELLITE_GROUPS.find((entry) => entry.value === this.ui.groupSelect.value);
    return group ? this.client.getQueryUrl({ [group.queryType]: group.value }) : '';
  }

  private refreshGui(): void {
    for (const controller of this.gui.controllersRecursive()) {
      controller.updateDisplay();
    }
  }

  private readonly handleResize = (): void => {
    this.camera.aspect = this.getCanvasAspect();
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.getCanvasWidth(), this.getCanvasHeight());
  };

  private readonly handleVisibilityChange = (): void => {
    this.clock.getDelta();
  };
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element: #${id}`);
  }

  return element as T;
}

new OrbitalSimulatorApp();
