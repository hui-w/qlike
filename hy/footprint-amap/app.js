(() => {
  const COLORS = [
    "#e41a1c",
    "#377eb8",
    "#4daf4a",
    "#984ea3",
    "#ff7f00",
    "#a65628",
    "#f781bf",
    "#666666",
    "#66c2a5",
    "#fc8d62",
    "#8da0cb",
    "#e78ac3",
    "#a6d854",
    "#ffd92f",
    "#e5c494",
  ];

  const AUTO_LOAD_FILES = [
    "data/2026.09.13.csv",
    "data/2026.09.14.csv",
    "data/2026.09.15.csv",
    "data/2026.09.16.csv",
    "data/2026.09.17.csv",
    "data/2026.09.18.csv",
    "data/2026.09.19.csv",
    "data/2026.09.20.csv",
    "data/2026.09.21.csv",
  ];

  const mapElement = document.getElementById("map");
  const controlPanel = document.getElementById("controlPanel");
  const fileInput = document.getElementById("fileInput");
  const clearBtn = document.getElementById("clearBtn");
  const fitBtn = document.getElementById("fitBtn");
  const satelliteBtn = document.getElementById("satelliteBtn");
  const statusEl = document.getElementById("status");
  const errorEl = document.getElementById("error");
  const legend = document.getElementById("legend");
  const dropOverlay = document.getElementById("dropOverlay");

  let map;
  let satelliteLayer;
  let roadNetLayer;
  let routes = [];

  function showConfigError(message) {
    statusEl.textContent = message;
    errorEl.textContent =
      "Set key and securityJsCode in hy/footprint-amap/amap-config.js, then reload.";
  }

  function loadAMap() {
    const config = window.AMAP_CONFIG;
    if (!config?.key || !config?.securityJsCode) {
      showConfigError("AMap credentials are not configured.");
      return;
    }

    window._AMapSecurityConfig = {
      securityJsCode: config.securityJsCode,
    };

    const script = document.createElement("script");
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.key)}`;
    script.onload = () => {
      map = new AMap.Map(mapElement, {
        zoom: 12,
        center: [116.397428, 39.90923],
        viewMode: "2D",
      });

      satelliteLayer = new AMap.TileLayer.Satellite();
      roadNetLayer = new AMap.TileLayer.RoadNet();
      map.on("complete", () => loadAutoFiles());
    };
    script.onerror = () => {
      showConfigError("Failed to load AMap. Check the key and network connection.");
    };
    document.head.appendChild(script);
  }

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            quoted = false;
          }
        } else {
          field += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (char !== "\r") {
        field += char;
      }
    }

    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }

    if (!rows.length) {
      return [];
    }

    const headers = rows[0].map((value) => value.trim());
    return rows
      .slice(1)
      .filter((values) => values.some((value) => value.trim()))
      .map((values) =>
        Object.fromEntries(
          headers.map((header, index) => [
            header,
            (values[index] ?? "").trim(),
          ]),
        ),
      );
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
    );
  }

  function coordinatesFrom(rows) {
    return rows
      .map((row) => {
        const longitude = Number(row.longitude);
        const latitude = Number(row.latitude);
        return Number.isFinite(longitude) && Number.isFinite(latitude)
          ? [longitude, latitude]
          : null;
      })
      .filter(Boolean);
  }

  function needsAmapCoordinateConversion([longitude, latitude]) {
    // AMap's GPS conversion covers China; overseas coordinates remain WGS84.
    return (
      longitude >= 72 &&
      longitude <= 137 &&
      latitude >= 0 &&
      latitude <= 56
    );
  }

  function convertCoordinates(coordinates, onProgress) {
    const batchSize = 40;
    const batches = [];
    const path = coordinates.map(
      ([longitude, latitude]) => new AMap.LngLat(longitude, latitude),
    );
    const domesticIndexes = coordinates
      .map((coordinate, index) =>
        needsAmapCoordinateConversion(coordinate) ? index : -1,
      )
      .filter((index) => index !== -1);

    for (let i = 0; i < domesticIndexes.length; i += batchSize) {
      const indexes = domesticIndexes.slice(i, i + batchSize);
      batches.push({
        index: batches.length,
        indexes,
        points: indexes.map((index) => coordinates[index]),
      });
    }

    let nextBatch = 0;
    let completed = coordinates.length - domesticIndexes.length;
    let conversionError = null;
    onProgress(completed, coordinates.length);

    async function worker() {
      while (nextBatch < batches.length && !conversionError) {
        const batch = batches[nextBatch++];
        try {
          const locations = await new Promise((resolve, reject) => {
            AMap.convertFrom(batch.points, "gps", (status, result) => {
              if (status !== "complete" || result?.info !== "ok") {
                reject(
                  new Error(
                    `AMap GPS coordinate conversion failed for batch ${batch.index + 1}/${batches.length} (route points ${batch.indexes[0] + 1}-${batch.indexes[batch.indexes.length - 1] + 1}): status=${status}, info=${result?.info || "unknown"}`,
                  ),
                );
                return;
              }
              resolve(result.locations);
            });
          });

          if (locations.length !== batch.points.length) {
            throw new Error(
              `AMap returned an incomplete coordinate batch (${locations.length}/${batch.points.length}).`,
            );
          }

          locations.forEach((location, index) => {
            path[batch.indexes[index]] = location;
          });
          completed += batch.points.length;
          onProgress(completed, coordinates.length);
        } catch (error) {
          conversionError = error;
        }
      }
    }

    return Promise.all(
      Array.from({ length: Math.min(4, batches.length) }, () => worker()),
    ).then(() => {
      if (conversionError) {
        throw conversionError;
      }
      return path;
    });
  }

  function updateStatus() {
    const pointCount = routes.reduce(
      (sum, route) => sum + route.pointCount,
      0,
    );
    const visibleCount = routes.filter((route) => route.visible).length;
    statusEl.textContent = !routes.length
      ? "Select or drop one or more CSV files."
      : `${routes.length} CSV file(s), ${visibleCount} visible, ${pointCount} GPS point(s)`;
  }

  function updateLegend() {
    if (!routes.length) {
      legend.innerHTML =
        '<div style="margin-top:6px;color:#666">Load CSV files to display routes.</div>';
      return;
    }

    legend.innerHTML = routes
      .map((route, index) => {
        const color = COLORS[index % COLORS.length];
        const name = route.fileName.replace(/\.[^/.]+$/, "");
        return `<div class="legendRow">
          <span class="swatch" style="background:${color}"></span>
          <button class="routeToggle ${route.visible ? "" : "hidden"}"
            data-index="${index}" title="${route.visible ? "Hide route" : "Show route"}">
            ${escapeHtml(name)}
          </button>
        </div>`;
      })
      .join("");

    legend.querySelectorAll(".routeToggle").forEach((button) => {
      button.addEventListener("click", () => {
        const route = routes[Number(button.dataset.index)];
        route.visible = !route.visible;
        route.polyline.setMap(route.visible ? map : null);
        updateLegend();
        updateStatus();
      });
    });
  }

  function fitAll() {
    if (!map) {
      return;
    }

    const visibleRoutes = routes
      .filter((route) => route.visible)
      .map((route) => route.polyline);
    if (visibleRoutes.length) {
      map.setFitView(visibleRoutes, false, [50, 50, 50, 50]);
    }
  }

  async function createRoute(fileName, text, routeIndex) {
    let rows = parseCSV(text);
    if (rows.some((row) => row.dataTime !== undefined)) {
      rows.sort(
        (a, b) => (Number(a.dataTime) || 0) - (Number(b.dataTime) || 0),
      );
    }

    const coordinates = coordinatesFrom(rows);
    if (coordinates.length < 2) {
      return null;
    }

    statusEl.textContent = `Converting ${fileName}: 0/${coordinates.length} GPS points`;
    const path = await convertCoordinates(coordinates, (done, total) => {
      statusEl.textContent = `Converting ${fileName}: ${done}/${total} GPS points`;
    });
    const color = COLORS[routeIndex % COLORS.length];
    return {
      fileName,
      pointCount: coordinates.length,
      visible: true,
      polyline: new AMap.Polyline({
        path,
        strokeColor: color,
        strokeOpacity: 0.8,
        strokeWeight: 6,
        lineJoin: "round",
        lineCap: "round",
      }),
    };
  }

  async function loadFiles(files) {
    if (!map) {
      errorEl.textContent = "AMap is not ready. Check the credentials and reload.";
      return;
    }

    errorEl.textContent = "";
    const newRoutes = [];
    for (const file of files) {
      try {
        const route = await createRoute(file.name, await file.text(), newRoutes.length);
        if (route) {
          newRoutes.push(route);
        }
      } catch (error) {
        console.error(error);
        errorEl.textContent = `Failed to load ${file.name}: ${error.message}`;
      }
    }

    if (routes.length) {
      map.remove(routes.map((route) => route.polyline));
    }
    routes = newRoutes;
    map.add(routes.map((route) => route.polyline));
    updateLegend();
    updateStatus();
    fitAll();
  }

  async function loadAutoFiles() {
    const files = [];
    for (const fileName of AUTO_LOAD_FILES) {
      try {
        const response = await fetch(fileName, { cache: "no-cache" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        files.push(
          new File([await response.blob()], fileName.split("/").pop(), {
            type: "text/csv",
          }),
        );
      } catch (error) {
        console.error(error);
        errorEl.textContent = `Failed to auto-load ${fileName}: ${error.message}`;
      }
    }
    if (files.length) {
      await loadFiles(files);
    }
  }

  document.addEventListener("dblclick", (event) => {
    if (controlPanel.contains(event.target)) {
      return;
    }
    controlPanel.classList.toggle("visible");
  });
  controlPanel.addEventListener("mousedown", (event) => event.stopPropagation());
  controlPanel.addEventListener("click", (event) => event.stopPropagation());

  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []);
    if (files.length) {
      await loadFiles(files);
    }
  });

  clearBtn.addEventListener("click", () => {
    if (!map) {
      return;
    }

    fileInput.value = "";
    map.remove(routes.map((route) => route.polyline));
    routes = [];
    updateLegend();
    updateStatus();
  });

  fitBtn.addEventListener("click", fitAll);

  satelliteBtn.addEventListener("click", () => {
    if (!map) {
      return;
    }

    const enabled = satelliteBtn.getAttribute("aria-pressed") !== "true";
    satelliteBtn.setAttribute("aria-pressed", String(enabled));
    if (enabled) {
      map.add([satelliteLayer, roadNetLayer]);
    } else {
      map.remove([satelliteLayer, roadNetLayer]);
    }
  });

  mapElement.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropOverlay.style.display = "flex";
  });
  mapElement.addEventListener("dragleave", (event) => {
    if (!mapElement.contains(event.relatedTarget)) {
      dropOverlay.style.display = "none";
    }
  });
  mapElement.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropOverlay.style.display = "none";
    const files = Array.from(event.dataTransfer.files || []).filter((file) =>
      file.name.toLowerCase().endsWith(".csv"),
    );
    if (files.length) {
      await loadFiles(files);
    }
  });

  loadAMap();
})();
