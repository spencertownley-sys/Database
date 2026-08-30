// Cascade surge shader — screen-space effect confined to the glass rect.
// Dense noise streams DOWN near the glass walls while lighter noise rises
// through the center, resolving over u_progress 0→1 into a settled dark body
// with a clean cream head boundary at the top.
//
// Uniforms (set by CascadeNode):
//   u_progress  0→1 settle progress, driven by the engine's settle timer
//   u_samples   noise octaves per fragment (Balance.cascadeQuality tier)
//   u_headFrac  head thickness as a fraction of this node's height

float hash21(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float streamNoise(vec2 uv, float direction, float speed, int octaves) {
    float acc = 0.0;
    float weight = 0.0;
    for (int i = 0; i < 6; i++) {
        if (i >= octaves) { break; }
        float fi = float(i);
        vec2 p = uv * vec2(8.0 + fi * 4.0, 26.0 + fi * 9.0);
        p.y += direction * u_time * speed * (1.0 + fi * 0.35);
        p.x += fi * 7.31;
        float w = 1.0 / (1.0 + fi);
        acc += hash21(floor(p)) * w;
        weight += w;
    }
    return acc / max(weight, 0.001);
}

void main() {
    vec2 uv = v_tex_coord;
    float progress = clamp(u_progress, 0.0, 1.0);
    int octaves = int(u_samples);

    // Distance from the nearest glass wall (0 at wall, 1 at center).
    float wall = 1.0 - abs(uv.x - 0.5) * 2.0;
    float wallBand = smoothstep(0.35, 0.0, wall);   // strong near walls
    float coreBand = smoothstep(0.25, 0.7, wall);   // strong in the middle

    // Two opposing currents: down the walls, up the core.
    float down = streamNoise(uv, 1.0, 1.6, octaves);
    float up = streamNoise(uv, -1.0, 0.9, octaves);
    float surge = down * wallBand * 0.85 + up * coreBand * 0.45;

    // The settled look: dark body, cream head above the boundary. The boundary
    // sharpens as the settle resolves.
    float headLine = 1.0 - u_headFrac;
    float edgeSoft = mix(0.25, 0.015, progress);
    float headMix = smoothstep(headLine - edgeSoft, headLine + edgeSoft, uv.y);

    vec3 body = vec3(0.075, 0.055, 0.045);
    vec3 headColor = vec3(0.93, 0.88, 0.78);
    vec3 settled = mix(body, headColor, headMix);

    // Surging pale streaks fade out as progress→1.
    float turbulence = surge * (1.0 - progress);
    vec3 surgeColor = mix(settled, vec3(0.82, 0.76, 0.66), turbulence * 0.85);

    gl_FragColor = vec4(surgeColor, 1.0) * v_color_mix.a;
}
