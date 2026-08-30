// Liquid surface shimmer — applied to the thin counter-rotated surface quad in
// GlassNode so the top of the liquid reads as a live meniscus, not a flat bar.
//
// Uniforms:
//   u_agitation  0 = still, 1 = pouring hard (drives ripple amplitude)

void main() {
    vec2 uv = v_tex_coord;
    float ripple = sin(uv.x * 22.0 + u_time * 5.0) * 0.5
        + sin(uv.x * 9.0 - u_time * 3.2) * 0.5;
    float amplitude = 0.06 + u_agitation * 0.22;
    float line = 0.5 + ripple * amplitude;

    // Bright meniscus streak fading vertically away from the ripple line.
    float distance = abs(uv.y - line);
    float glow = smoothstep(0.45, 0.0, distance);
    vec4 base = texture2D(u_texture, uv) * v_color_mix;
    gl_FragColor = vec4(base.rgb + vec3(0.20, 0.16, 0.10) * glow, base.a);
}
