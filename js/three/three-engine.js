import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.min.js";

(function () {
  "use strict";

  const MAX_COINS = 260;
  const MAX_SEASON_PARTICLES = 72;
  const LOCAL_VISIBLE_GRACE_MS = 140;
  const CAMERA_LERP = 0.09;
  const MATERIAL_EPSILON = 0.0001;

  const reducedMotionQuery = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  const source = {
    map: null,
    viewport: null,
    pellets: null,
    powerups: null,
    creeps: null,
    remotePlayers: null,
    localPacman: null,
    localOptions: null,
    localSeenAt: 0
  };

  const state = {
    enabled: readEnabledPreference(),
    ready: false,
    failed: false,
    active: false,
    mount: null,
    board: null,
    button: null,
    canvasViewButton: null,
    renderer: null,
    scene: null,
    camera: null,
    cameraLookAt: new THREE.Vector3(),
    desiredCamera: new THREE.Vector3(),
    desiredLookAt: new THREE.Vector3(),
    clock: new THREE.Clock(),
    world: null,
    terrain: null,
    buildings: null,
    actors: null,
    effects: null,
    citizens: null,
    lights: null,
    ambientLight: null,
    sunLight: null,
    mapRef: null,
    localActor: null,
    remoteActors: new Map(),
    ghostActors: new Map(),
    powerActors: new Map(),
    citizenActors: new Map(),
    buildingRecords: [],
    coinBody: null,
    coinFace: null,
    coinRim: null,
    coinDummy: new THREE.Object3D(),
    coinCount: 0,
    seasonPoints: null,
    seasonPositions: null,
    seasonSeeds: [],
    materialCache: new Map(),
    tileMaterials: null,
    currentEnvironment: null,
    lastSeasonId: null,
    seasonAnnouncementTimer: 0,
    frameHandle: 0,
    resizeObserver: null,
    lastTime: performance.now() / 1000,
    stats: {
      calls: 0,
      triangles: 0
    }
  };

  function readEnabledPreference() {
    try {
      return window.localStorage.getItem("pacman-renderer") !== "2d";
    } catch (_error) {
      return true;
    }
  }

  function writeEnabledPreference(enabled) {
    try {
      window.localStorage.setItem("pacman-renderer", enabled ? "3d" : "2d");
    } catch (_error) {
      // Renderer preference is optional.
    }
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function smoothstep(edge0, edge1, value) {
    if (edge0 === edge1) return value < edge0 ? 0 : 1;
    const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return x * x * (3 - 2 * x);
  }

  function seededValue(value) {
    let x = Math.trunc(value) || 1;
    x ^= x >>> 16;
    x = Math.imul(x, 0x7feb352d);
    x ^= x >>> 15;
    x = Math.imul(x, 0x846ca68b);
    x ^= x >>> 16;
    return (x >>> 0) / 4294967295;
  }

  function colorValue(value, fallback = 0xffffff) {
    try {
      return new THREE.Color(value || fallback);
    } catch (_error) {
      return new THREE.Color(fallback);
    }
  }

  function materialKey(prefix, color, extra = "") {
    return `${prefix}:${String(color)}:${extra}`;
  }

  function cachedMaterial(prefix, color, options = {}) {
    const key = materialKey(
      prefix,
      color,
      [
        options.emissive || "",
        options.transparent ? "t" : "o",
        options.opacity ?? 1,
        options.metalness ?? 0,
        options.roughness ?? 0.8
      ].join(":")
    );

    if (state.materialCache.has(key)) {
      return state.materialCache.get(key);
    }

    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: options.emissive || 0x000000,
      emissiveIntensity: options.emissiveIntensity ?? 0,
      metalness: options.metalness ?? 0.04,
      roughness: options.roughness ?? 0.78,
      transparent: Boolean(options.transparent),
      opacity: options.opacity ?? 1,
      depthWrite: options.depthWrite ?? !options.transparent,
      side: options.side || THREE.FrontSide
    });

    state.materialCache.set(key, material);
    return material;
  }

  function disposeObject(object) {
    if (!object) return;

    object.traverse?.((child) => {
      child.geometry?.dispose?.();

      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material?.dispose?.());
      } else if (
        child.material &&
        !Array.from(state.materialCache.values()).includes(child.material)
      ) {
        child.material.dispose?.();
      }
    });

    object.parent?.remove(object);
  }

  function clearGroup(group) {
    if (!group) return;
    [...group.children].forEach((child) => disposeObject(child));
  }

  function shouldUseThree() {
    return Boolean(
      state.enabled &&
      state.ready &&
      !state.failed &&
      window.ElementalPacman?.isRunning?.()
    );
  }

  function shouldSuppressCanvas() {
    return shouldUseThree();
  }

  function installDrawCapture(ClassRef, methodName, capture) {
    const prototype = ClassRef?.prototype;
    const current = prototype?.[methodName];

    if (!prototype || typeof current !== "function") return false;
    if (current.__pacThreeCaptureInstalled) return true;

    const wrapped = function pacThreeCapturedDraw(...args) {
      capture.call(this, args);

      if (shouldSuppressCanvas()) {
        return undefined;
      }

      return current.apply(this, args);
    };

    wrapped.__pacThreeCaptureInstalled = true;
    wrapped.__pacThreeOriginal = current;
    prototype[methodName] = wrapped;
    return true;
  }

  function installCaptureHooks() {
    installDrawCapture(window.MazeMap, "draw", function captureMap(args) {
      source.map = this;
      source.viewport = args[1] || source.viewport;
    });

    installDrawCapture(window.PelletManager, "draw", function capturePellets() {
      source.pellets = this;
    });

    installDrawCapture(window.PowerUpManager, "draw", function capturePowerups() {
      source.powerups = this;
    });

    installDrawCapture(window.CreepManager, "draw", function captureCreeps() {
      source.creeps = this;
    });

    installDrawCapture(
      window.RemotePlayerManager,
      "draw",
      function captureRemotePlayers() {
        source.remotePlayers = this;
      }
    );

    installDrawCapture(window.Pacman, "draw", function capturePacman(args) {
      const options = args[2] || {};
      if (options.variant === "remote") return;

      source.localPacman = this;
      source.localOptions = options;
      source.localSeenAt = performance.now();
    });
  }

  function createRenderer() {
    state.board = document.querySelector("#gameShell .board-wrap");
    state.mount = document.getElementById("threeGameViewport");
    state.button = document.getElementById("graphicsModeButton");
    state.canvasViewButton = document.getElementById("viewButton");

    if (!state.board || !state.mount) {
      throw new Error("P.A.C Three.js viewport was not found in index.html.");
    }

    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x17212a);
    state.scene.fog = new THREE.Fog(0x17212a, 22, 74);

    state.camera = new THREE.PerspectiveCamera(39, 16 / 9, 0.1, 180);
    // Keep world X horizontal and world Z vertical on screen. This makes
    // joystick Up/Down/Left/Right match the rendered roads exactly.
    state.camera.position.set(0, 16.2, 8.8);

    state.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance"
    });

    const mobile = window.matchMedia("(max-width: 950px)").matches;
    const pixelRatioCap = mobile ? 1.25 : 1.65;

    state.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, pixelRatioCap)
    );
    state.renderer.outputColorSpace = THREE.SRGBColorSpace;
    state.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    state.renderer.toneMappingExposure = 1.08;
    state.renderer.shadowMap.enabled = false;
    state.renderer.domElement.setAttribute("aria-hidden", "true");

    state.mount.replaceChildren(state.renderer.domElement);

    state.world = new THREE.Group();
    state.terrain = new THREE.Group();
    state.buildings = new THREE.Group();
    state.actors = new THREE.Group();
    state.effects = new THREE.Group();
    state.citizens = new THREE.Group();
    state.lights = new THREE.Group();

    state.world.add(state.terrain);
    state.world.add(state.buildings);
    state.world.add(state.citizens);
    state.world.add(state.actors);
    state.world.add(state.effects);
    state.scene.add(state.world);
    state.scene.add(state.lights);

    state.ambientLight = new THREE.HemisphereLight(0xb9ddff, 0x25351e, 1.2);
    state.sunLight = new THREE.DirectionalLight(0xfff0c8, 1.5);
    state.sunLight.position.set(20, 30, 12);
    state.lights.add(state.ambientLight, state.sunLight);

    createSeasonParticles();
    resizeRenderer();

    if (window.ResizeObserver) {
      state.resizeObserver = new ResizeObserver(resizeRenderer);
      state.resizeObserver.observe(state.board);
    } else {
      window.addEventListener("resize", resizeRenderer);
    }

    state.ready = true;
    state.failed = false;
    updateModeButton();
  }

  function resizeRenderer() {
    if (!state.renderer || !state.camera || !state.board) return;

    const rect = state.board.getBoundingClientRect();
    const width = Math.max(280, Math.round(rect.width || window.innerWidth));
    const height = Math.max(240, Math.round(rect.height || window.innerHeight * 0.7));

    state.camera.aspect = width / height;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(width, height, false);
  }

  function createInstancedTiles(tiles, geometry, material, y) {
    if (!tiles.length) return null;

    const mesh = new THREE.InstancedMesh(geometry, material, tiles.length);
    const dummy = new THREE.Object3D();

    tiles.forEach((tile, index) => {
      dummy.position.set(tile.x, y, tile.y);
      dummy.rotation.set(0, tile.rotation || 0, 0);
      dummy.scale.set(tile.scaleX || 1, tile.scaleY || 1, tile.scaleZ || 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });

    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    state.terrain.add(mesh);
    return mesh;
  }

  function buildTerrain(map) {
    clearGroup(state.terrain);

    const roads = [];
    const walkways = [];
    const grass = [];
    const zebraStripes = [];

    for (let y = 0; y < map.rows; y += 1) {
      for (let x = 0; x < map.cols; x += 1) {
        if (map.grid?.[y]?.[x] === 1) {
          grass.push({ x, y });
          continue;
        }

        const surface = typeof map.getSurface === "function"
          ? map.getSurface(x, y)
          : { type: "road" };

        if (surface?.type === "walkway") {
          walkways.push({ x, y });
        } else {
          roads.push({ x, y });
        }

        if (surface?.type === "zebra") {
          const vertical = surface.orientation === "vertical";
          for (let stripe = -2; stripe <= 2; stripe += 1) {
            zebraStripes.push({
              x: x + (vertical ? 0 : stripe * 0.15),
              y: y + (vertical ? stripe * 0.15 : 0),
              rotation: vertical ? 0 : Math.PI / 2
            });
          }
        }
      }
    }

    state.tileMaterials = {
      road: cachedMaterial("tile-road", 0x30373d, {
        roughness: 0.9,
        metalness: 0.04
      }),
      walkway: cachedMaterial("tile-walk", 0xb8beb9, {
        roughness: 0.93
      }),
      grass: cachedMaterial("tile-grass", 0x456b3f, {
        roughness: 1
      }),
      zebra: cachedMaterial("tile-zebra", 0xf0eee2, {
        roughness: 0.82
      })
    };

    const roadGeometry = new THREE.BoxGeometry(1.015, 0.055, 1.015);
    const walkwayGeometry = new THREE.BoxGeometry(1.015, 0.09, 1.015);
    const grassGeometry = new THREE.BoxGeometry(1.015, 0.075, 1.015);
    const stripeGeometry = new THREE.BoxGeometry(0.62, 0.018, 0.085);

    createInstancedTiles(roads, roadGeometry, state.tileMaterials.road, 0.012);
    createInstancedTiles(
      walkways,
      walkwayGeometry,
      state.tileMaterials.walkway,
      0.035
    );
    createInstancedTiles(grass, grassGeometry, state.tileMaterials.grass, 0.022);
    createInstancedTiles(
      zebraStripes,
      stripeGeometry,
      state.tileMaterials.zebra,
      0.073
    );

    const perimeter = new THREE.LineSegments(
      new THREE.EdgesGeometry(
        new THREE.BoxGeometry(map.cols, 0.32, map.rows)
      ),
      new THREE.LineBasicMaterial({
        color: 0x7d8991,
        transparent: true,
        opacity: 0.22
      })
    );
    perimeter.position.set((map.cols - 1) / 2, 0.02, (map.rows - 1) / 2);
    state.terrain.add(perimeter);
  }

  function lotCentre(lot) {
    return {
      x: lot.x + (lot.w - 1) * 0.5,
      z: lot.y + (lot.h - 1) * 0.5
    };
  }

  function registerBuilding(group, lot, materials) {
    group.userData.lot = lot;
    group.userData.materials = materials.filter(Boolean);
    group.userData.bounds = {
      minX: lot.x - 0.45,
      maxX: lot.x + lot.w - 0.55,
      minZ: lot.y - 0.45,
      maxZ: lot.y + lot.h - 0.55
    };
    state.buildingRecords.push(group);
    state.buildings.add(group);
  }

  function createBuilding(lot, index) {
    const group = new THREE.Group();
    const centre = lotCentre(lot);
    const width = Math.max(0.65, lot.w * 0.78);
    const depth = Math.max(0.65, lot.h * 0.78);
    const kind = lot.kind || "smallBuilding";

    if (kind === "cone") {
      const coneMaterial = cachedMaterial(`cone-${index}`, lot.accent || 0xf0793e, {
        emissive: 0x2c0d00,
        emissiveIntensity: 0.18,
        roughness: 0.7
      });
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.2, 0.58, 12),
        coneMaterial
      );
      cone.position.set(centre.x, 0.31, centre.z);
      group.add(cone);
      registerBuilding(group, lot, [coneMaterial]);
      return;
    }

    if (kind === "park") {
      createPark(group, lot, index);
      registerBuilding(group, lot, []);
      return;
    }

    if (kind === "stall") {
      createStall(group, lot, centre, width, depth, index);
      registerBuilding(
        group,
        lot,
        group.children.map((child) => child.material)
      );
      return;
    }

    let height = 1.55;
    if (kind === "shop") height = 1.25;
    if (kind === "smallBuilding") height = 1.85;
    if (kind === "housing") height = 2.25;
    if (kind === "school") height = 1.6;
    if (kind === "office") height = 2.9;
    if (kind === "mall") height = 2.45;
    if (kind === "bigBuilding") height = 3.1;

    height += (Number(lot.variant) || 0) * 0.09;

    const roofColor = lot.palette?.roof || 0x667783;
    const sideColor = lot.palette?.side || 0x394751;
    const edgeColor = lot.palette?.edge || 0xbfcbd2;
    const glassColor = lot.palette?.glass || 0x7ec9df;

    const bodyMaterial = cachedMaterial(`building-body-${index}`, sideColor, {
      roughness: kind === "office" ? 0.48 : 0.82,
      metalness: kind === "office" ? 0.14 : 0.04
    });
    const roofMaterial = cachedMaterial(`building-roof-${index}`, roofColor, {
      roughness: 0.72,
      metalness: 0.08
    });
    const glassMaterial = cachedMaterial(`building-glass-${index}`, glassColor, {
      emissive: glassColor,
      emissiveIntensity: 0.3,
      roughness: 0.25,
      metalness: 0.1
    });
    const signMaterial = cachedMaterial(`building-sign-${index}`, lot.accent || edgeColor, {
      emissive: lot.accent || edgeColor,
      emissiveIntensity: 0.32,
      roughness: 0.38,
      metalness: 0.12
    });

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      bodyMaterial
    );
    body.position.set(centre.x, height * 0.5 + 0.07, centre.z);
    group.add(body);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.94, 0.18, depth * 0.94),
      roofMaterial
    );
    roof.position.set(centre.x, height + 0.16, centre.z);
    group.add(roof);

    const windowRows = kind === "office" ? 3 : height > 2 ? 2 : 1;
    const windowColumns = Math.max(2, Math.min(6, lot.w * 2));

    for (let row = 0; row < windowRows; row += 1) {
      for (let column = 0; column < windowColumns; column += 1) {
        const windowWidth = width / (windowColumns + 1);
        const wx = centre.x - width * 0.38 + column * (width * 0.76 / Math.max(1, windowColumns - 1));
        const wy = 0.55 + row * Math.max(0.38, (height - 0.75) / windowRows);

        const frontWindow = new THREE.Mesh(
          new THREE.BoxGeometry(windowWidth * 0.56, 0.16, 0.035),
          glassMaterial
        );
        frontWindow.position.set(wx, wy, centre.z + depth * 0.5 + 0.02);
        group.add(frontWindow);
      }
    }

    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(Math.min(width * 0.7, 1.45), 0.16, 0.06),
      signMaterial
    );
    sign.position.set(
      centre.x,
      Math.min(height * 0.48, 1.35),
      centre.z + depth * 0.5 + 0.045
    );
    group.add(sign);

    const rooftopUnits = Math.min(3, Math.max(0, Number(lot.rooftopUnits) || 0));
    const unitMaterial = cachedMaterial(`roof-unit-${index}`, 0x5b646b, {
      roughness: 0.88
    });

    for (let unit = 0; unit < rooftopUnits; unit += 1) {
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.16, 0.2),
        unitMaterial
      );
      box.position.set(
        centre.x - width * 0.22 + unit * 0.27,
        height + 0.33,
        centre.z - depth * 0.08
      );
      group.add(box);
    }

    if (["shop", "mall", "school"].includes(kind)) {
      addFakeLamp(group, centre.x - width * 0.52, centre.z + depth * 0.52, lot.lightColor);
      if (width > 2) {
        addFakeLamp(group, centre.x + width * 0.52, centre.z + depth * 0.52, lot.lightColor);
      }
    }

    registerBuilding(group, lot, [
      bodyMaterial,
      roofMaterial,
      glassMaterial,
      signMaterial,
      unitMaterial
    ]);
  }

  function createStall(group, lot, centre, width, depth, index) {
    const baseMaterial = cachedMaterial(`stall-base-${index}`, 0x4a3e34, {
      roughness: 0.9
    });
    const awningMaterial = cachedMaterial(`stall-awning-${index}`, lot.accent || 0xef6b52, {
      emissive: lot.accent || 0xef6b52,
      emissiveIntensity: 0.1,
      roughness: 0.65
    });

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(width, 0.58, depth),
      baseMaterial
    );
    base.position.set(centre.x, 0.35, centre.z);
    group.add(base);

    const awning = new THREE.Mesh(
      new THREE.BoxGeometry(width * 1.08, 0.1, depth * 1.05),
      awningMaterial
    );
    awning.position.set(centre.x, 0.78, centre.z);
    group.add(awning);
  }

  function createPark(group, lot, index) {
    const centre = lotCentre(lot);
    const parkMaterial = cachedMaterial("park-ground", 0x3f743f, {
      roughness: 1
    });
    const trunkMaterial = cachedMaterial("tree-trunk", 0x67452f, {
      roughness: 1
    });
    const leafMaterial = cachedMaterial("tree-leaf", 0x4e8448, {
      roughness: 0.95
    });

    const ground = new THREE.Mesh(
      new THREE.BoxGeometry(lot.w * 0.92, 0.1, lot.h * 0.92),
      parkMaterial
    );
    ground.position.set(centre.x, 0.08, centre.z);
    group.add(ground);

    const treeCount = Math.max(2, Math.min(5, Math.round(lot.w * lot.h * 0.28)));
    for (let tree = 0; tree < treeCount; tree += 1) {
      const sx = seededValue(index * 73 + tree * 17 + 1);
      const sz = seededValue(index * 97 + tree * 29 + 3);
      const x = lot.x - 0.25 + sx * Math.max(0.5, lot.w - 0.5);
      const z = lot.y - 0.25 + sz * Math.max(0.5, lot.h - 0.5);

      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.07, 0.5, 7),
        trunkMaterial
      );
      trunk.position.set(x, 0.35, z);
      group.add(trunk);

      const crown = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.28 + seededValue(tree + index) * 0.08, 1),
        leafMaterial
      );
      crown.position.set(x, 0.72, z);
      group.add(crown);
    }
  }

  function addFakeLamp(group, x, z, color) {
    const poleMaterial = cachedMaterial("lamp-pole", 0x434b51, {
      roughness: 0.75,
      metalness: 0.22
    });
    const bulbColor = color || 0xffd978;
    const bulbMaterial = cachedMaterial("lamp-bulb", bulbColor, {
      emissive: bulbColor,
      emissiveIntensity: 0.75,
      roughness: 0.25
    });

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.035, 0.7, 7),
      poleMaterial
    );
    pole.position.set(x, 0.43, z);
    group.add(pole);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 10, 8),
      bulbMaterial
    );
    bulb.position.set(x, 0.82, z);
    bulb.userData.isLampBulb = true;
    group.add(bulb);
  }

  function buildBuildings(map) {
    clearGroup(state.buildings);
    state.buildingRecords = [];

    (Array.isArray(map.lots) ? map.lots : []).forEach(createBuilding);
  }

  function buildWorld(map) {
    state.mapRef = map;
    buildTerrain(map);
    buildBuildings(map);
    clearActors();
    ensureCoinMeshes();
  }

  function clearActors() {
    disposeObject(state.localActor);
    state.localActor = null;

    state.remoteActors.forEach(disposeObject);
    state.remoteActors.clear();

    state.ghostActors.forEach(disposeObject);
    state.ghostActors.clear();

    state.powerActors.forEach(disposeObject);
    state.powerActors.clear();

    state.citizenActors.forEach(disposeObject);
    state.citizenActors.clear();
  }

  function createPacActor(remote = false) {
    const group = new THREE.Group();
    group.userData.remote = remote;

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: remote ? 0xc8b565 : 0xe8c44c,
      emissive: 0x4a3400,
      emissiveIntensity: 0.25,
      roughness: 0.4,
      metalness: 0.18
    });

    /*
     * P.A.C Core: a rounded arcade creature with a circular animated maw.
     * The mouth is inset into the body instead of sticking out like a beak.
     */
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 28, 22),
      bodyMaterial
    );
    body.scale.set(1.04, 0.98, 1.04);
    group.add(body);

    const mouthMaterial = new THREE.MeshStandardMaterial({
      color: 0x080b0e,
      emissive: 0x020304,
      emissiveIntensity: 0.18,
      roughness: 0.92,
      metalness: 0
    });

    const mouthCore = new THREE.Mesh(
      new THREE.CircleGeometry(0.19, 30),
      mouthMaterial
    );
    mouthCore.rotation.y = Math.PI / 2;
    mouthCore.position.set(0.407, -0.015, 0);
    mouthCore.scale.set(1, 0.82, 1);
    group.add(mouthCore);

    const jawMaterial = bodyMaterial.clone();
    const upperJawPivot = new THREE.Group();
    const lowerJawPivot = new THREE.Group();

    const upperLip = new THREE.Mesh(
      new THREE.TorusGeometry(0.185, 0.047, 10, 28, Math.PI),
      jawMaterial
    );
    upperLip.rotation.y = Math.PI / 2;
    upperLip.position.x = 0.405;
    upperJawPivot.add(upperLip);

    const lowerLip = new THREE.Mesh(
      new THREE.TorusGeometry(0.185, 0.047, 10, 28, Math.PI),
      jawMaterial
    );
    lowerLip.rotation.set(0, Math.PI / 2, Math.PI);
    lowerLip.position.x = 0.405;
    lowerJawPivot.add(lowerLip);

    group.add(upperJawPivot, lowerJawPivot);

    const eyeWhiteMaterial = new THREE.MeshStandardMaterial({
      color: 0xf8f5dc,
      emissive: remote ? 0x5d6268 : 0xded59e,
      emissiveIntensity: remote ? 0.16 : 0.38,
      roughness: 0.3,
      metalness: 0.04
    });
    const pupilMaterial = new THREE.MeshStandardMaterial({
      color: remote ? 0x28313a : 0x15232d,
      emissive: remote ? 0x030506 : 0x0a3340,
      emissiveIntensity: remote ? 0.06 : 0.34,
      roughness: 0.24,
      metalness: 0.12
    });

    [-0.125, 0.125].forEach((z) => {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.075, 14, 11),
        eyeWhiteMaterial
      );
      eye.scale.set(0.48, 1.08, 0.82);
      eye.position.set(0.34, 0.18, z);
      group.add(eye);

      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(0.031, 10, 8),
        pupilMaterial
      );
      pupil.scale.set(0.48, 1, 0.82);
      pupil.position.set(0.395, 0.177, z);
      group.add(pupil);
    });

    const browMaterial = new THREE.MeshStandardMaterial({
      color: remote ? 0x6e747a : 0x8a6d20,
      emissive: remote ? 0x080a0c : 0x332000,
      emissiveIntensity: 0.14,
      roughness: 0.48,
      metalness: 0.16
    });

    [-0.125, 0.125].forEach((z, index) => {
      const brow = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, 0.105, 8),
        browMaterial
      );
      brow.rotation.x = Math.PI / 2;
      brow.rotation.y = index === 0 ? -0.12 : 0.12;
      brow.position.set(0.382, 0.264, z);
      group.add(brow);
    });

    const sideBandMaterial = new THREE.MeshStandardMaterial({
      color: remote ? 0x8f989f : 0xffe889,
      emissive: remote ? 0x11161b : 0x5b4000,
      emissiveIntensity: remote ? 0.12 : 0.28,
      roughness: 0.32,
      metalness: 0.42,
      transparent: true,
      opacity: 0.78
    });

    const accentRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.407, 0.017, 8, 36),
      sideBandMaterial
    );
    accentRing.rotation.y = Math.PI / 2;
    group.add(accentRing);

    const crown = new THREE.Group();
    const crownMaterial = new THREE.MeshStandardMaterial({
      color: 0xffe36b,
      emissive: 0x7a4f00,
      emissiveIntensity: 0.38,
      metalness: 0.7,
      roughness: 0.24
    });

    const crownBand = new THREE.Mesh(
      new THREE.TorusGeometry(0.19, 0.025, 8, 24),
      crownMaterial
    );
    crownBand.rotation.x = Math.PI / 2;
    crownBand.position.y = 0.38;
    crown.add(crownBand);

    for (let spike = 0; spike < 5; spike += 1) {
      const spikeMesh = new THREE.Mesh(
        new THREE.ConeGeometry(0.035, 0.12, 6),
        crownMaterial
      );
      const angle = spike * (Math.PI * 2 / 5);
      spikeMesh.position.set(
        Math.cos(angle) * 0.15,
        0.46,
        Math.sin(angle) * 0.15
      );
      crown.add(spikeMesh);
    }
    crown.visible = false;
    group.add(crown);

    const elementHalo = new THREE.Mesh(
      new THREE.TorusGeometry(0.48, 0.018, 8, 36),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.54,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    elementHalo.rotation.x = Math.PI / 2;
    elementHalo.position.y = -0.33;
    elementHalo.visible = false;
    group.add(elementHalo);

    const wake = new THREE.Group();
    for (let index = 0; index < 3; index += 1) {
      const trail = new THREE.Mesh(
        new THREE.TorusGeometry(0.23 - index * 0.035, 0.018, 6, 24, Math.PI * 1.45),
        new THREE.MeshBasicMaterial({
          color: 0xffedaa,
          transparent: true,
          opacity: 0.22 - index * 0.045,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      trail.rotation.y = Math.PI / 2;
      trail.position.x = -0.48 - index * 0.24;
      wake.add(trail);
    }
    wake.visible = false;
    group.add(wake);

    group.userData.body = body;
    group.userData.bodyMaterial = bodyMaterial;
    group.userData.jawMaterial = jawMaterial;
    group.userData.mouthCore = mouthCore;
    group.userData.upperJawPivot = upperJawPivot;
    group.userData.lowerJawPivot = lowerJawPivot;
    group.userData.accentRing = accentRing;
    group.userData.crown = crown;
    group.userData.elementHalo = elementHalo;
    group.userData.wake = wake;
    group.userData.lastSkinKey = "";

    return group;
  }

  function resolveSkin(rawSkin, remote, accountName = "") {
    const options = remote
      ? {
          variant: "remote",
          skin: rawSkin,
          accountName,
          label: accountName
        }
      : source.localOptions || {};

    return (
      window.PacmanSkins?.resolveDrawSkin?.(options) ||
      window.PacmanSkins?.getLocalSkin?.() || {
        light: "#f2dc7f",
        mid: "#d2b347",
        dark: "#755414",
        glow: "rgba(231, 197, 73, 0.7)",
        sparkle: false,
        metallic: false,
        element: null,
        accent: null,
        accentLight: null
      }
    );
  }

  function applyPacSkin(actor, skin, remote) {
    if (!actor || !skin) return;

    const skinKey = JSON.stringify({
      light: skin.light,
      mid: skin.mid,
      dark: skin.dark,
      accent: skin.accent,
      metallic: skin.metallic,
      sparkle: skin.sparkle,
      element: skin.element
    });

    if (actor.userData.lastSkinKey === skinKey) return;
    actor.userData.lastSkinKey = skinKey;

    const bodyColor = colorValue(skin.mid, remote ? 0xc1b166 : 0xe0bd42);
    actor.userData.bodyMaterial.color.copy(bodyColor);
    actor.userData.bodyMaterial.emissive.copy(
      colorValue(skin.dark, 0x4a3200).multiplyScalar(0.45)
    );
    actor.userData.bodyMaterial.metalness = skin.metallic ? 0.72 : 0.16;
    actor.userData.bodyMaterial.roughness = skin.metallic ? 0.23 : 0.42;

    actor.userData.jawMaterial.color.copy(bodyColor);
    actor.userData.jawMaterial.emissive.copy(
      colorValue(skin.dark, 0x4a3200).multiplyScalar(0.45)
    );
    actor.userData.jawMaterial.metalness = skin.metallic ? 0.72 : 0.16;
    actor.userData.jawMaterial.roughness = skin.metallic ? 0.23 : 0.42;

    const accent = skin.accent || skin.accentLight || skin.light || "#fff0a0";
    actor.userData.accentRing.material.color.set(accent);
    actor.userData.accentRing.material.emissive.set(accent);
    actor.userData.accentRing.material.emissiveIntensity = remote ? 0.16 : 0.35;

    actor.userData.crown.visible = Boolean(skin.metallic && !remote);
    actor.userData.elementHalo.visible = Boolean(skin.element);
    actor.userData.elementHalo.material.color.set(accent);

    actor.userData.wake.children.forEach((trail) => {
      trail.material.color.set(skin.accentLight || skin.light || accent);
    });
  }

  function updatePacActor(actor, pacman, options = {}) {
    if (!actor || !pacman) return;

    const time = options.time || 0;
    const remote = Boolean(options.remote);
    const moving = Boolean(pacman.dir?.x || pacman.dir?.y);
    const skin = resolveSkin(options.skin, remote, options.accountName);
    const nearMiss = options.nearMiss || null;

    applyPacSkin(actor, skin, remote);

    actor.position.set(
      Number(pacman.x) || 0,
      0.48 + (moving ? Math.sin(time * 10) * 0.035 : 0),
      Number(pacman.y) || 0
    );
    actor.rotation.y = -(Number(pacman.angle) || 0);
    actor.visible = options.alive !== false;

    const bite = moving
      ? 0.08 + Math.abs(Math.sin((Number(pacman.movingTime) || time) * 12)) * 0.34
      : 0.06;

    actor.userData.upperJawPivot.rotation.z = -bite * 0.58;
    actor.userData.lowerJawPivot.rotation.z = bite * 0.58;
    if (actor.userData.mouthCore) {
      actor.userData.mouthCore.scale.y = 0.68 + bite * 1.35;
    }
    actor.userData.accentRing.rotation.x = time * 0.7;
    actor.userData.elementHalo.rotation.z = time * 1.4;
    actor.userData.crown.rotation.y = time * 0.7;

    const wakeCount = Math.max(0, Number(nearMiss?.wakeCount) || 0);
    actor.userData.wake.visible = moving && wakeCount > 0;
    actor.userData.wake.children.forEach((trail, index) => {
      trail.visible = index < Math.min(3, wakeCount);
      trail.rotation.x = Math.sin(time * 2 + index) * 0.08;
    });
  }

  function syncPacActors(time) {
    if (!source.localPacman) return;

    if (!state.localActor) {
      state.localActor = createPacActor(false);
      state.actors.add(state.localActor);
    }

    const localRecentlyDrawn =
      performance.now() - source.localSeenAt < LOCAL_VISIBLE_GRACE_MS;
    const localNearMiss =
      window.PacmanNearMiss?.resolveDrawState?.(source.localOptions || {}) || null;

    updatePacActor(state.localActor, source.localPacman, {
      time,
      remote: false,
      alive: localRecentlyDrawn,
      nearMiss: localNearMiss
    });

    const remotes = source.remotePlayers?.getPlayerActors?.() || [];
    const activeIds = new Set();

    remotes.forEach((remote) => {
      if (!remote?.userId) return;
      activeIds.add(remote.userId);

      let actor = state.remoteActors.get(remote.userId);
      if (!actor) {
        actor = createPacActor(true);
        state.remoteActors.set(remote.userId, actor);
        state.actors.add(actor);
      }

      updatePacActor(
        actor,
        {
          x: remote.x,
          y: remote.y,
          dir: remote.dir,
          angle: remote.angle,
          movingTime: time
        },
        {
          time,
          remote: true,
          alive: remote.alive !== false,
          skin: remote.skin,
          nearMiss: remote.nearMiss,
          accountName: remote.accountName || `Player ${remote.playerSlot || ""}`
        }
      );
    });

    state.remoteActors.forEach((actor, userId) => {
      if (activeIds.has(userId)) return;
      disposeObject(actor);
      state.remoteActors.delete(userId);
    });
  }

  function ghostPalette(creep) {
    const fallback = {
      fire: { color: "#ff4f2d", glow: "#ff7b45" },
      water: { color: "#3aa6ff", glow: "#8cd7ff" },
      lightning: { color: "#f5df3f", glow: "#fff598" },
      earth: { color: "#77c95a", glow: "#a6d986" },
      shadow: { color: "#11151b", glow: "#6c7185" }
    };

    const base = fallback[creep.element] || fallback.shadow;
    return {
      color: creep.profile?.color || base.color,
      glow: creep.profile?.glow || base.glow
    };
  }


  function createAlertMarker() {
    const marker = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: 0xffd84d,
      emissive: 0xff5b16,
      emissiveIntensity: 0.95,
      roughness: 0.28,
      metalness: 0.12
    });

    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.18, 10),
      material
    );
    bar.position.y = 0.1;
    marker.add(bar);

    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 12, 9),
      material
    );
    dot.position.y = -0.105;
    marker.add(dot);

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.15, 0.012, 6, 20),
      new THREE.MeshBasicMaterial({
        color: 0xffd84d,
        transparent: true,
        opacity: 0.56,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    halo.position.y = 0.02;
    marker.add(halo);

    marker.position.y = 0.82;
    marker.visible = false;
    marker.userData.halo = halo;
    return marker;
  }

  function createPuppyActor(creep) {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xbfc7d0,
      emissive: 0x33414f,
      emissiveIntensity: 0.32,
      roughness: 0.3,
      metalness: 0.58
    });

    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.33, 24, 18),
      bodyMaterial
    );
    body.scale.set(1, 0.98, 1);
    group.add(body);

    const eyeWhiteMaterial = new THREE.MeshStandardMaterial({
      color: 0xf9fcff,
      emissive: 0xdcecff,
      emissiveIntensity: 0.34,
      roughness: 0.22
    });
    const irisMaterial = new THREE.MeshStandardMaterial({
      color: 0x385d80,
      emissive: 0x173b58,
      emissiveIntensity: 0.5,
      roughness: 0.18,
      metalness: 0.1
    });
    const pupilMaterial = new THREE.MeshStandardMaterial({
      color: 0x05090e,
      roughness: 0.16
    });

    [-0.12, 0.12].forEach((z) => {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.105, 14, 11),
        eyeWhiteMaterial
      );
      eye.scale.set(0.52, 1.15, 0.78);
      eye.position.set(0.27, 0.06, z);
      group.add(eye);

      const iris = new THREE.Mesh(
        new THREE.SphereGeometry(0.057, 11, 9),
        irisMaterial
      );
      iris.scale.set(0.5, 1.1, 0.78);
      iris.position.set(0.326, 0.055, z);
      group.add(iris);

      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 9, 7),
        pupilMaterial
      );
      pupil.scale.set(0.5, 1.05, 0.78);
      pupil.position.set(0.362, 0.052, z);
      group.add(pupil);
    });

    const aura = new THREE.Mesh(
      new THREE.TorusGeometry(0.4, 0.014, 7, 28),
      new THREE.MeshBasicMaterial({
        color: 0xc8ecff,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    aura.rotation.x = Math.PI / 2;
    aura.position.y = -0.3;
    group.add(aura);

    const tears = new THREE.Group();
    [-0.12, 0.12].forEach((z) => {
      const tear = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 9, 7),
        new THREE.MeshBasicMaterial({
          color: 0x7fd5ff,
          transparent: true,
          opacity: 0.86,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      tear.scale.set(0.7, 1.45, 0.7);
      tear.position.set(0.35, -0.02, z);
      tears.add(tear);
    });
    tears.visible = false;
    group.add(tears);

    group.userData.isPuppy = true;
    group.userData.bodyMaterial = bodyMaterial;
    group.userData.effect = aura;
    group.userData.tears = tears;
    group.userData.phase = Number(creep.animOffset) || Math.random() * Math.PI * 2;
    return group;
  }

  function createGhostActor(creep) {
    if (creep?.isPuppy) return createPuppyActor(creep);
    const palette = ghostPalette(creep);
    const element = creep.isElite ? "shadow" : creep.element;
    const water = element === "water";

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: palette.color,
      emissive: colorValue(palette.color).multiplyScalar(0.38),
      emissiveIntensity: element === "shadow" ? 0.42 : 0.34,
      roughness: element === "earth" ? 0.86 : 0.5,
      metalness: element === "lightning" ? 0.18 : 0.04,
      transparent: water,
      opacity: water ? 0.84 : 1,
      depthWrite: !water
    });

    const group = new THREE.Group();

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(creep.isElite ? 0.37 : 0.35, 20, 14),
      bodyMaterial
    );
    dome.scale.y = 0.88;
    dome.position.y = 0.08;
    group.add(dome);

    const skirt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.34, 0.29, 18),
      bodyMaterial
    );
    skirt.position.y = -0.12;
    group.add(skirt);

    const lobeGeometry = new THREE.SphereGeometry(0.105, 10, 8);
    for (let lobe = -2; lobe <= 2; lobe += 1) {
      const lobeMesh = new THREE.Mesh(lobeGeometry, bodyMaterial);
      lobeMesh.position.set(0, -0.28, lobe * 0.105);
      group.add(lobeMesh);
    }

    const eyeMaterial = cachedMaterial("ghost-eye", 0xf4f7f8, {
      emissive: 0xdde8ec,
      emissiveIntensity: 0.28,
      roughness: 0.28
    });
    const pupilMaterial = new THREE.MeshStandardMaterial({
      color: element === "shadow" ? 0xff2d47 : 0x15202a,
      emissive: element === "shadow" ? 0x8f0017 : 0x000000,
      emissiveIntensity: element === "shadow" ? 0.75 : 0,
      roughness: 0.25
    });

    [-0.115, 0.115].forEach((z) => {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 12, 10),
        eyeMaterial
      );
      eye.scale.set(0.72, 1, 0.62);
      eye.position.set(0.285, 0.075, z);
      group.add(eye);

      const pupil = new THREE.Mesh(
        new THREE.SphereGeometry(0.038, 9, 7),
        pupilMaterial
      );
      pupil.position.set(0.34, 0.07, z);
      group.add(pupil);
    });

    const effect = new THREE.Mesh(
      new THREE.TorusGeometry(0.43, 0.016, 7, 30),
      new THREE.MeshBasicMaterial({
        color: palette.color,
        transparent: true,
        opacity: element === "shadow" ? 0.28 : 0.48,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    effect.rotation.x = Math.PI / 2;
    effect.position.y = -0.3;
    group.add(effect);

    const particles = new THREE.Group();
    for (let index = 0; index < 3; index += 1) {
      const particle = new THREE.Mesh(
        element === "lightning"
          ? new THREE.BoxGeometry(0.035, 0.14, 0.035)
          : new THREE.SphereGeometry(0.035, 7, 5),
        new THREE.MeshBasicMaterial({
          color: palette.glow,
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );
      particles.add(particle);
    }
    group.add(particles);

    const alertMarker = createAlertMarker();
    group.add(alertMarker);

    group.userData.element = element;
    group.userData.bodyMaterial = bodyMaterial;
    group.userData.effect = effect;
    group.userData.particles = particles;
    group.userData.alertMarker = alertMarker;
    group.userData.phase = Number(creep.animOffset) || Math.random() * Math.PI * 2;
    return group;
  }

  function syncGhosts(time) {
    const hostileCreeps = source.creeps?.creeps || [];
    const puppy = source.creeps?.puppy || null;
    const creeps = puppy ? [...hostileCreeps, puppy] : hostileCreeps;
    const activeIds = new Set();

    creeps.forEach((creep, index) => {
      const id = creep.id || `creep-${index}`;
      activeIds.add(id);

      let actor = state.ghostActors.get(id);
      const actorTypeChanged = Boolean(actor) &&
        Boolean(actor.userData.isPuppy) !== Boolean(creep.isPuppy);

      if (actorTypeChanged) {
        disposeObject(actor);
        state.ghostActors.delete(id);
        actor = null;
      }

      if (!actor) {
        actor = createGhostActor(creep);
        state.ghostActors.set(id, actor);
        state.actors.add(actor);
      }

      const phase = actor.userData.phase + index * 0.13;
      const bobSpeed = creep.isPuppy ? 5.4 : 4.2;
      const bob = Math.sin(time * bobSpeed + phase) * 0.055;
      const panicShake = creep.isPuppy && creep.afraid
        ? Math.sin(time * 24 + phase) * 0.025
        : 0;

      actor.position.set(creep.x + panicShake, 0.49 + bob, creep.y);
      actor.rotation.y = -Math.atan2(
        Number(creep.dir?.y) || 0,
        Number(creep.dir?.x) || 0.001
      );

      if (creep.isPuppy) {
        actor.scale.setScalar(creep.afraid ? 0.96 : 1);
        actor.userData.effect.rotation.z = time * (creep.afraid ? 2.6 : 0.8) + phase;
        actor.userData.effect.material.opacity = creep.afraid ? 0.72 : 0.42;
        actor.userData.bodyMaterial.emissiveIntensity = creep.afraid ? 0.55 : 0.32;
        actor.userData.tears.visible = Boolean(creep.afraid);
        actor.userData.tears.children.forEach((tear, tearIndex) => {
          const fall = (time * 2.8 + phase + tearIndex * 0.46) % 1;
          tear.position.y = -0.01 - fall * 0.28;
          tear.material.opacity = 0.9 - fall * 0.55;
        });
        return;
      }

      actor.scale.setScalar(creep.alerted ? 1.06 : 1);
      actor.userData.effect.rotation.z = time * (creep.alerted ? 2.1 : 0.8) + phase;
      actor.userData.effect.material.opacity = creep.alerted ? 0.72 : 0.38;

      if (actor.userData.alertMarker) {
        actor.userData.alertMarker.visible = Boolean(creep.alerted);
        actor.userData.alertMarker.position.y =
          0.83 + Math.sin(time * 7 + phase) * 0.045;
        actor.userData.alertMarker.rotation.y = -actor.rotation.y;
        actor.userData.alertMarker.userData.halo.rotation.z = time * 2.8;
      }

      const palette = ghostPalette(creep);
      actor.userData.bodyMaterial.color.set(palette.color);
      actor.userData.bodyMaterial.emissive.copy(
        colorValue(palette.color).multiplyScalar(creep.alerted ? 0.58 : 0.36)
      );

      actor.userData.particles.children.forEach((particle, particleIndex) => {
        const angle = time * (1.7 + particleIndex * 0.22) + phase + particleIndex * 2.1;
        const radius = 0.36 + particleIndex * 0.04;
        particle.position.set(
          Math.cos(angle) * radius,
          Math.sin(time * 2.4 + particleIndex + phase) * 0.18,
          Math.sin(angle) * radius
        );
        particle.rotation.z = angle;
      });
    });

    state.ghostActors.forEach((actor, id) => {
      if (activeIds.has(id)) return;
      disposeObject(actor);
      state.ghostActors.delete(id);
    });
  }

  function ensureCoinMeshes() {
    disposeObject(state.coinBody);
    disposeObject(state.coinFace);
    disposeObject(state.coinRim);

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xe6ad24,
      emissive: 0x5e3500,
      emissiveIntensity: 0.42,
      roughness: 0.28,
      metalness: 0.86
    });
    const faceMaterial = new THREE.MeshStandardMaterial({
      color: 0xffe36e,
      emissive: 0x7f5200,
      emissiveIntensity: 0.36,
      roughness: 0.22,
      metalness: 0.76
    });
    const rimMaterial = new THREE.MeshStandardMaterial({
      color: 0xfff0a5,
      emissive: 0x8d6600,
      emissiveIntensity: 0.4,
      roughness: 0.18,
      metalness: 0.82
    });

    state.coinBody = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.17, 0.17, 0.055, 18),
      bodyMaterial,
      MAX_COINS
    );
    state.coinFace = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.125, 0.125, 0.061, 18),
      faceMaterial,
      MAX_COINS
    );
    const coinRimGeometry = new THREE.TorusGeometry(0.153, 0.016, 7, 18);
    coinRimGeometry.rotateX(-Math.PI / 2);

    state.coinRim = new THREE.InstancedMesh(
      coinRimGeometry,
      rimMaterial,
      MAX_COINS
    );

    [state.coinBody, state.coinFace, state.coinRim].forEach((mesh) => {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      state.effects.add(mesh);
    });
  }

  function syncCoins(time) {
    if (!state.coinBody || !source.pellets?.pellets) return;

    const pellets = Array.from(source.pellets.pellets.values()).slice(0, MAX_COINS);
    const dummy = state.coinDummy;

    pellets.forEach((pellet, index) => {
      const phase = Number(pellet.phase) || index * 0.43;
      const spin = Number(pellet.spin) || 1;
      const bob = Math.sin(time * 3.2 + phase) * 0.055;

      dummy.position.set(pellet.x, 0.31 + bob, pellet.y);
      dummy.rotation.set(Math.PI / 2, time * spin * 3.4 + phase, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();

      state.coinBody.setMatrixAt(index, dummy.matrix);
      state.coinFace.setMatrixAt(index, dummy.matrix);
      state.coinRim.setMatrixAt(index, dummy.matrix);
    });

    state.coinCount = pellets.length;
    [state.coinBody, state.coinFace, state.coinRim].forEach((mesh) => {
      mesh.count = state.coinCount;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    });
  }

  function powerColor(type) {
    if (type === "rush") return 0x3a9cff;
    if (type === "hunter") return 0x161b22;
    return 0xe64655;
  }

  function createPowerActor(item) {
    const group = new THREE.Group();
    const color = powerColor(item.type);

    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xe7ebef,
      emissive: 0x2a3038,
      emissiveIntensity: 0.2,
      roughness: 0.3,
      metalness: 0.28
    });
    const bandMaterial = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.62,
      roughness: 0.26,
      metalness: 0.3
    });

    const centre = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.26, 14),
      bodyMaterial
    );
    centre.rotation.z = Math.PI / 2;
    group.add(centre);

    [-0.13, 0.13].forEach((x, index) => {
      const end = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 14, 10),
        index === 0 ? bandMaterial : bodyMaterial
      );
      end.scale.x = 0.72;
      end.position.x = x;
      group.add(end);
    });

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.23, 0.015, 7, 24),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    group.userData.ring = ring;
    group.userData.phase = Number(item.phase) || Math.random() * Math.PI * 2;
    return group;
  }

  function syncPowerups(time) {
    const items = source.powerups?.powerUps
      ? Array.from(source.powerups.powerUps.values())
      : [];
    const activeIds = new Set();

    items.forEach((item) => {
      activeIds.add(item.id);

      let actor = state.powerActors.get(item.id);
      if (!actor) {
        actor = createPowerActor(item);
        state.powerActors.set(item.id, actor);
        state.effects.add(actor);
      }

      const phase = actor.userData.phase;
      actor.position.set(
        item.x,
        0.38 + Math.sin(time * 3 + phase) * 0.07,
        item.y
      );
      actor.rotation.y = time * 1.6 + phase;
      actor.userData.ring.rotation.z = time * 1.8 + phase;
    });

    state.powerActors.forEach((actor, id) => {
      if (activeIds.has(id)) return;
      disposeObject(actor);
      state.powerActors.delete(id);
    });
  }

  function createCitizenActor(citizen) {
    const group = new THREE.Group();
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: citizen.color || 0x56616d,
      roughness: 0.82,
      metalness: 0.02
    });
    const skinMaterial = cachedMaterial("citizen-skin", 0xcaa98d, {
      roughness: 0.85
    });

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, 0.24, 7),
      bodyMaterial
    );
    body.position.y = 0.18;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.075, 10, 8),
      skinMaterial
    );
    head.position.y = 0.36;
    group.add(head);

    const legMaterial = cachedMaterial("citizen-leg", 0x232b31, {
      roughness: 0.9
    });
    const leftLeg = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.16, 0.045),
      legMaterial
    );
    const rightLeg = leftLeg.clone();
    leftLeg.position.set(-0.035, 0.02, 0);
    rightLeg.position.set(0.035, 0.02, 0);
    group.add(leftLeg, rightLeg);

    group.userData.leftLeg = leftLeg;
    group.userData.rightLeg = rightLeg;
    group.userData.phase = Number(citizen.phase) || 0;
    return group;
  }

  function syncCitizens(environment, time) {
    const routines = source.map?.citizenRoutines;
    const citizens = routines?.citizens || [];
    const activeIds = new Set();
    const legacyCycleSeconds = Number(environment.cycleSeconds || 0) * 2;

    citizens.forEach((citizen) => {
      const position = routines.stateAt?.(citizen, legacyCycleSeconds);
      if (!position) return;

      activeIds.add(citizen.id);
      let actor = state.citizenActors.get(citizen.id);
      if (!actor) {
        actor = createCitizenActor(citizen);
        state.citizenActors.set(citizen.id, actor);
        state.citizens.add(actor);
      }

      actor.visible = true;
      actor.position.set(position.x, 0.08, position.y);
      actor.rotation.y = -Math.atan2(position.dirY || 0, position.dirX || 0.001);

      const step = Math.sin(time * 10 + actor.userData.phase) * 0.35;
      actor.userData.leftLeg.rotation.z = step;
      actor.userData.rightLeg.rotation.z = -step;
    });

    state.citizenActors.forEach((actor, id) => {
      actor.visible = activeIds.has(id);
    });
  }

  function createSeasonParticles() {
    const positions = new Float32Array(MAX_SEASON_PARTICLES * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.08,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    state.seasonPoints = new THREE.Points(geometry, material);
    state.seasonPositions = positions;
    state.seasonSeeds = Array.from(
      { length: MAX_SEASON_PARTICLES },
      (_, index) => ({
        x: seededValue(index * 811 + 11),
        y: seededValue(index * 577 + 23),
        z: seededValue(index * 997 + 41)
      })
    );
    state.seasonPoints.visible = false;
    state.effects.add(state.seasonPoints);
  }

  function fallbackEnvironment() {
    const elapsed = Number(
      window.PacmanLivingCity?.getSharedElapsed?.()
    ) || 0;
    const cycle = ((elapsed % 120) + 120) % 120;
    const nightAmount = cycle < 52
      ? 0
      : cycle < 60
        ? smoothstep(52, 60, cycle)
        : cycle < 112
          ? 1
          : 1 - smoothstep(112, 120, cycle);

    return {
      elapsed,
      cycleSeconds: cycle,
      season: { id: "spring", name: "Spring", icon: "✦" },
      dayAmount: 1 - nightAmount,
      nightAmount,
      phase: nightAmount > 0.9 ? "night" : nightAmount > 0.1 ? "dusk" : "day",
      showerAmount: 0
    };
  }

  function getEnvironment() {
    return window.PacmanSeasons?.getEnvironment?.() || fallbackEnvironment();
  }

  function updateSeasonParticles(environment, time) {
    if (!state.seasonPoints || !source.map || !source.localPacman) return;

    const seasonId = environment.season?.id || "spring";
    const active = ["spring", "autumn", "winter"].includes(seasonId);
    state.seasonPoints.visible = active;
    if (!active) return;

    const count = reducedMotionQuery.matches ? 24 : MAX_SEASON_PARTICLES;
    const positions = state.seasonPositions;
    const centreX = source.localPacman.x;
    const centreZ = source.localPacman.y;
    const spanX = 17;
    const spanZ = 13;

    state.seasonPoints.geometry.setDrawRange(0, count);

    state.seasonSeeds.forEach((seed, index) => {
      const speed = seasonId === "winter" ? 0.8 : seasonId === "autumn" ? 0.55 : 0.4;
      const drift = seasonId === "autumn" ? Math.sin(time * 0.8 + index) * 1.4 : 0;
      const x = centreX - spanX * 0.5 + ((seed.x * spanX + time * speed + drift) % spanX);
      const z = centreZ - spanZ * 0.5 + ((seed.z * spanZ + time * speed * 0.45) % spanZ);
      const y = 0.3 + ((seed.y * 7 - time * (seasonId === "winter" ? 0.55 : 0.32)) % 7 + 7) % 7;

      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;
    });

    const material = state.seasonPoints.material;
    if (seasonId === "winter") {
      material.color.set(0xeef8ff);
      material.size = 0.09;
      material.opacity = 0.72;
    } else if (seasonId === "autumn") {
      material.color.set(0xd38a3e);
      material.size = 0.1;
      material.opacity = 0.6;
    } else {
      material.color.set(environment.showerAmount > 0.1 ? 0x9ed9e8 : 0xe8cfe1);
      material.size = environment.showerAmount > 0.1 ? 0.055 : 0.085;
      material.opacity = 0.55;
    }

    state.seasonPoints.geometry.attributes.position.needsUpdate = true;
  }

  function updateEnvironment(environment, time) {
    state.currentEnvironment = environment;

    const day = clamp(Number(environment.dayAmount) || 0, 0, 1);
    const night = clamp(Number(environment.nightAmount) || 0, 0, 1);
    const seasonId = environment.season?.id || "spring";

    const skyBySeason = {
      spring: new THREE.Color(0x94b7bd),
      summer: new THREE.Color(0xa9c9e0),
      autumn: new THREE.Color(0xb8896a),
      winter: new THREE.Color(0xa8bdc8)
    };
    const nightSky = new THREE.Color(0x0b1320);
    const daySky = skyBySeason[seasonId] || skyBySeason.spring;
    const sky = nightSky.clone().lerp(daySky, day);

    state.scene.background.copy(sky);
    state.scene.fog.color.copy(sky.clone().multiplyScalar(0.82));
    state.scene.fog.near = 18 + day * 8;
    state.scene.fog.far = 55 + day * 28;

    state.ambientLight.intensity = 0.55 + day * 1.05;
    state.ambientLight.color.set(night > 0.5 ? 0x92aee2 : 0xc5e2ff);
    state.ambientLight.groundColor.set(
      seasonId === "winter" ? 0x65767b : 0x2c4027
    );

    state.sunLight.intensity = 0.16 + day * 1.65;
    state.sunLight.color.set(
      seasonId === "autumn"
        ? 0xffc588
        : seasonId === "summer"
          ? 0xffe4a6
          : 0xfff0cf
    );
    state.sunLight.position.set(
      18 + Math.sin(time * 0.05) * 5,
      25,
      10 + Math.cos(time * 0.05) * 5
    );

    if (state.tileMaterials) {
      const palettes = {
        spring: {
          road: 0x303a3d,
          walkway: 0xbcc4be,
          grass: 0x477644
        },
        summer: {
          road: 0x393634,
          walkway: 0xc4c0b5,
          grass: 0x4f7e35
        },
        autumn: {
          road: 0x3c3835,
          walkway: 0xbfb09f,
          grass: 0x706231
        },
        winter: {
          road: 0x56636d,
          walkway: 0xe0e7e9,
          grass: 0xbac9cb
        }
      };
      const palette = palettes[seasonId] || palettes.spring;
      state.tileMaterials.road.color.set(palette.road);
      state.tileMaterials.walkway.color.set(palette.walkway);
      state.tileMaterials.grass.color.set(palette.grass);
      state.tileMaterials.road.roughness =
        seasonId === "spring" && environment.showerAmount > 0.1 ? 0.45 : 0.9;
      state.tileMaterials.road.metalness =
        seasonId === "spring" && environment.showerAmount > 0.1 ? 0.16 : 0.04;
    }

    state.buildings.traverse((child) => {
      if (!child.material) return;
      if (child.userData.isLampBulb) {
        child.material.emissiveIntensity = 0.25 + night * 1.25;
      } else if (
        child.material.emissive &&
        child.material.emissive.getHex() !== 0
      ) {
        child.material.emissiveIntensity = 0.18 + night * 0.62;
      }
    });

    updateSeasonStatus(environment);
    updateSeasonParticles(environment, time);
  }

  function updateSeasonStatus(environment) {
    const status = document.getElementById("seasonStatus");
    if (!status) return;

    const phase = String(environment.phase || "day").toUpperCase();
    status.hidden = !window.ElementalPacman?.isRunning?.();
    status.dataset.season = environment.season?.id || "spring";
    status.textContent = `${environment.season?.icon || "✦"} ${String(
      environment.season?.name || "Spring"
    ).toUpperCase()} · ${phase}`;

    if (state.board) {
      state.board.dataset.season = environment.season?.id || "spring";
    }

    const seasonId = environment.season?.id || "spring";
    if (state.lastSeasonId !== seasonId) {
      state.lastSeasonId = seasonId;
      const announcement = document.getElementById("seasonAnnouncement");
      if (announcement) {
        if (state.seasonAnnouncementTimer) {
          window.clearTimeout(state.seasonAnnouncementTimer);
        }
        announcement.textContent = `${String(
          environment.season?.name || "Spring"
        ).toUpperCase()} HAS ARRIVED`;
        announcement.dataset.season = seasonId;
        announcement.classList.remove("is-visible");
        window.requestAnimationFrame(() => {
          announcement.classList.add("is-visible");
        });
        state.seasonAnnouncementTimer = window.setTimeout(() => {
          announcement.classList.remove("is-visible");
        }, 2400);
      }
    }
  }

  function updateBuildingOcclusion() {
    if (!source.localPacman) return;

    const px = Number(source.localPacman.x) || 0;
    const pz = Number(source.localPacman.y) || 0;

    state.buildingRecords.forEach((building) => {
      const bounds = building.userData.bounds;
      const near =
        px >= bounds.minX - 0.65 &&
        px <= bounds.maxX + 0.65 &&
        pz >= bounds.minZ - 0.65 &&
        pz <= bounds.maxZ + 0.65;
      const targetOpacity = near ? 0.3 : 1;

      building.userData.materials.forEach((material) => {
        if (!material || material === state.tileMaterials?.grass) return;

        material.opacity += (targetOpacity - material.opacity) * 0.14;
        if (Math.abs(material.opacity - 1) < MATERIAL_EPSILON) {
          material.opacity = 1;
        }

        const wantsTransparency =
          targetOpacity < 1 || material.opacity < 0.999;
        if (material.transparent !== wantsTransparency) {
          material.transparent = wantsTransparency;
          material.needsUpdate = true;
        }

        const wantsDepthWrite = material.opacity > 0.75;
        if (material.depthWrite !== wantsDepthWrite) {
          material.depthWrite = wantsDepthWrite;
          material.needsUpdate = true;
        }
      });
    });
  }

  function updateCamera(dt) {
    if (!source.localPacman || !state.camera) return;

    const mobile = window.matchMedia("(max-width: 950px)").matches;
    const x = Number(source.localPacman.x) || 0;
    const z = Number(source.localPacman.y) || 0;
    const dirX = Number(source.localPacman.dir?.x) || 0;
    const dirZ = Number(source.localPacman.dir?.y) || 0;

    const lead = mobile ? 0.48 : 0.72;
    state.desiredLookAt.set(x + dirX * lead, 0.1, z + dirZ * lead);

    // Camera stays directly south of the player with zero left/right yaw.
    // Therefore: joystick left/right = screen left/right, and up/down =
    // screen up/down. The higher elevation also reduces the heavy slant.
    state.desiredCamera.set(
      x,
      mobile ? 14.8 : 16.4,
      z + (mobile ? 7.3 : 8.6)
    );

    const smoothing = 1 - Math.pow(1 - CAMERA_LERP, Math.max(1, dt * 60));
    state.camera.position.lerp(state.desiredCamera, smoothing);
    state.cameraLookAt.lerp(state.desiredLookAt, smoothing);
    state.camera.lookAt(state.cameraLookAt);
  }

  function updateModeButton() {
    if (!state.button) return;
    state.button.textContent = state.enabled ? "Graphics: 3D" : "Graphics: 2D";
    state.button.setAttribute("aria-pressed", String(state.enabled));
    state.button.dataset.mode = state.enabled ? "three" : "canvas";
    state.button.title = state.enabled
      ? "Use the Three.js miniature city renderer"
      : "Use the original Canvas renderer";

    if (state.canvasViewButton) {
      state.canvasViewButton.disabled = state.enabled;
      state.canvasViewButton.title = state.enabled
        ? "Switch Graphics to 2D before changing the Canvas depth style"
        : "Change the original Canvas depth style";
    }
  }

  function setEnabled(enabled) {
    state.enabled = Boolean(enabled);
    writeEnabledPreference(state.enabled);
    updateModeButton();

    if (!state.enabled) {
      state.board?.classList.remove("is-three-ready");
    }
  }

  function toggleEnabled() {
    setEnabled(!state.enabled);
  }

  function updateActiveClass() {
    const active = shouldUseThree();
    state.active = active;
    state.board?.classList.toggle("is-three-ready", active);
    state.mount?.setAttribute("aria-hidden", String(!active));
  }

  function renderFrame() {
    state.frameHandle = window.requestAnimationFrame(renderFrame);

    if (!state.ready || state.failed) return;

    updateActiveClass();
    if (!state.active) return;
    if (!source.map || !source.localPacman) return;

    if (source.map !== state.mapRef) {
      buildWorld(source.map);
    }

    const now = performance.now() / 1000;
    const dt = Math.min(0.05, Math.max(0, now - state.lastTime));
    state.lastTime = now;

    const environment = getEnvironment();
    syncCoins(now);
    syncPowerups(now);
    syncPacActors(now);
    syncGhosts(now);
    syncCitizens(environment, now);
    updateEnvironment(environment, now);
    updateBuildingOcclusion();
    updateCamera(dt);

    state.renderer.render(state.scene, state.camera);
    state.stats.calls = state.renderer.info.render.calls;
    state.stats.triangles = state.renderer.info.render.triangles;
  }

  function installButton() {
    if (!state.button) return;
    state.button.addEventListener("click", toggleEnabled);
    updateModeButton();
  }

  function handleFailure(error) {
    state.failed = true;
    state.ready = false;
    state.enabled = false;
    state.board?.classList.remove("is-three-ready");
    console.error("P.A.C Three.js renderer could not start.", error);

    if (state.button) {
      state.button.textContent = "Graphics: 2D";
      state.button.disabled = true;
      state.button.title = "Three.js could not start on this device. Canvas mode remains available.";
    }
  }

  function bootstrap() {
    try {
      installCaptureHooks();
      createRenderer();
      installButton();
      renderFrame();

      document.addEventListener("pacman:room-started", () => {
        state.lastSeasonId = null;
        updateActiveClass();
      });
      document.addEventListener("pacman:room-left", updateActiveClass);
      document.addEventListener("pacman:room-closed", updateActiveClass);
      document.addEventListener("visibilitychange", () => {
        state.lastTime = performance.now() / 1000;
      });

      window.PacmanThreeRenderer = Object.freeze({
        setEnabled,
        toggle: toggleEnabled,
        isEnabled: () => state.enabled,
        isReady: () => state.ready && !state.failed,
        getStats: () => ({ ...state.stats }),
        getSourceState: () => ({
          hasMap: Boolean(source.map),
          hasPacman: Boolean(source.localPacman),
          pelletCount: source.pellets?.count || 0,
          creepCount: source.creeps?.count || 0,
          remoteCount: source.remotePlayers?.count || 0
        })
      });
    } catch (error) {
      handleFailure(error);
    }
  }

  bootstrap();
})();
