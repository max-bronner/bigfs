/**
 * Starting points for a new particle system: a few common looks, written
 * in the block form BFME uses with only fields its own systems use, so a
 * new effect starts from something that already moves instead of from an
 * empty block. The values are bigFS's own, not taken from any game file.
 * Each is a snippet: the name and the texture are tab stops.
 */

/** Starting point for a new particle system, as the template picker lists it */
export interface ParticleTemplate {
  label: string;
  /** One-line description of the look, shown beside the label */
  detail: string;
  /** The block after its header line, two-space indented */
  body: string;
}

/** Templates the new-particle-system command offers, in the order shown */
export const PARTICLE_TEMPLATES: readonly ParticleTemplate[] = [
  {
    label: 'Fire',
    detail: 'Rising flames: additive, yellow to red to dark, fading in and out',
    body: `  System
    Priority = VERY_LOW_OR_ABOVE
    ParticleName = \${2:fire.tga}
    Shader = ADDITIVE
    Lifetime = 24 34
    SystemLifetime = 0
    Size = 6 9
    BurstDelay = 1 1
    BurstCount = 2 3
  End
  Color = DefaultColor
    Color1 = R:255 G:220 B:120 0
    Color2 = R:255 G:120 B:30 12
    Color3 = R:120 G:30 B:10 30
  End
  Alpha = DefaultAlpha
    Alpha1 = 0.00 0.00 0
    Alpha2 = 0.90 1.00 5
    Alpha3 = 0.00 0.00 34
  End
  Update = DefaultUpdate
    SizeRate = -0.15 -0.05
    SizeRateDamping = 1.00 1.00
    AngleZ = -3.14 3.14
    AngularRateZ = -0.03 0.03
    AngularDamping = 1.00 1.00
  End
  Physics = DefaultPhysics
    VelocityDamping = 0.95 0.97
    DriftVelocity = X:0 Y:0 Z:0.4
  End
  EmissionVelocity = OrthoEmissionVelocity
    X = -0.2 0.2
    Y = -0.2 0.2
    Z = 0.8 1.4
  End
  EmissionVolume = CylinderEmissionVolume
    Radius = 6
    Length = 1
  End
  Draw = DefaultDraw
  End`,
  },
  {
    label: 'Smoke',
    detail: 'A slow grey plume that grows, drifts with the wind and fades',
    body: `  System
    Priority = LOW_OR_ABOVE
    ParticleName = \${2:smoke.tga}
    Shader = ALPHA
    Lifetime = 70 100
    SystemLifetime = 0
    Size = 8 12
    BurstDelay = 4 6
    BurstCount = 1 1
  End
  Color = DefaultColor
    Color1 = R:90 G:90 B:90 0
    Color2 = R:160 G:160 B:160 100
  End
  Alpha = DefaultAlpha
    Alpha1 = 0.00 0.00 0
    Alpha2 = 0.45 0.60 15
    Alpha3 = 0.00 0.00 100
  End
  Update = DefaultUpdate
    SizeRate = 0.30 0.45
    SizeRateDamping = 0.99 0.99
    AngleZ = -3.14 3.14
    AngularRateZ = -0.01 0.01
    AngularDamping = 1.00 1.00
  End
  Physics = DefaultPhysics
    VelocityDamping = 0.97 0.98
    DriftVelocity = X:0 Y:0 Z:0.25
  End
  EmissionVelocity = OrthoEmissionVelocity
    X = -0.1 0.1
    Y = -0.1 0.1
    Z = 0.6 0.9
  End
  EmissionVolume = SphereEmissionVolume
    Radius = 4
  End
  Draw = DefaultDraw
  End
  Wind = DefaultWind
    WindMotion = PingPong
    WindStrength = 1.0
    WindAngleChangeMin = 0.1
    WindAngleChangeMax = 0.3
    WindPingPongStartAngleMin = 0
    WindPingPongStartAngleMax = 0.5
    WindPingPongEndAngleMin = 4.5
    WindPingPongEndAngleMax = 6
  End`,
  },
  {
    label: 'Sparks',
    detail: 'One burst of small additive sparks thrown out and pulled down',
    body: `  System
    Priority = HIGH_OR_ABOVE
    ParticleName = \${2:spark.tga}
    Shader = ADDITIVE
    Lifetime = 15 25
    SystemLifetime = 1
    Size = 1 2
    BurstDelay = 1 1
    BurstCount = 20 30
    IsOneShot = Yes
  End
  Color = DefaultColor
    Color1 = R:255 G:240 B:180 0
    Color2 = R:255 G:140 B:40 10
    Color3 = R:120 G:40 B:0 25
  End
  Alpha = DefaultAlpha
    Alpha1 = 1.00 1.00 0
    Alpha2 = 0.00 0.00 25
  End
  Update = DefaultUpdate
    SizeRate = -0.04 -0.02
    SizeRateDamping = 1.00 1.00
  End
  Physics = DefaultPhysics
    Gravity = -0.12
    VelocityDamping = 0.96 0.98
  End
  EmissionVelocity = SphericalEmissionVelocity
    Speed = 1.5 3.0
  End
  EmissionVolume = PointEmissionVolume
  End
  Draw = DefaultDraw
  End`,
  },
  {
    label: 'Dust cloud',
    detail:
      'A low cloud rolling out along the ground, as from a charge or a fall',
    body: `  System
    Priority = MEDIUM_OR_ABOVE
    ParticleName = \${2:dust.tga}
    Shader = ALPHA
    Lifetime = 40 60
    SystemLifetime = 8
    Size = 6 10
    BurstDelay = 1 2
    BurstCount = 2 3
  End
  Color = DefaultColor
    Color1 = R:150 G:130 B:100 0
    Color2 = R:120 G:105 B:85 60
  End
  Alpha = DefaultAlpha
    Alpha1 = 0.00 0.00 0
    Alpha2 = 0.50 0.65 6
    Alpha3 = 0.00 0.00 60
  End
  Update = DefaultUpdate
    SizeRate = 0.35 0.50
    SizeRateDamping = 0.97 0.98
    AngleZ = -3.14 3.14
    AngularDamping = 1.00 1.00
  End
  Physics = DefaultPhysics
    VelocityDamping = 0.92 0.94
  End
  EmissionVelocity = OutwardEmissionVelocity
    Speed = 1.0 1.8
    OtherSpeed = 0.1 0.3
  End
  EmissionVolume = CylinderEmissionVolume
    Radius = 10
    Length = 0
  End
  Draw = DefaultDraw
  End`,
  },
  {
    label: 'Magic glow',
    detail: 'A soft pulsing aura: additive motes rising from a hollow sphere',
    body: `  System
    Priority = VERY_LOW_OR_ABOVE
    ParticleName = \${2:glow.tga}
    Shader = ADDITIVE
    Lifetime = 30 45
    SystemLifetime = 0
    Size = 3 5
    BurstDelay = 2 3
    BurstCount = 1 2
  End
  Color = DefaultColor
    Color1 = R:120 G:200 B:255 0
    Color2 = R:180 G:120 B:255 30
    Color3 = R:40 G:20 B:120 45
  End
  Alpha = DefaultAlpha
    Alpha1 = 0.00 0.00 0
    Alpha2 = 0.80 1.00 10
    Alpha3 = 0.00 0.00 45
  End
  Update = DefaultUpdate
    SizeRate = -0.05 0.05
    SizeRateDamping = 1.00 1.00
  End
  Physics = DefaultPhysics
    VelocityDamping = 0.98 0.99
    DriftVelocity = X:0 Y:0 Z:0.15
  End
  EmissionVelocity = OrthoEmissionVelocity
    Z = 0.1 0.3
  End
  EmissionVolume = SphereEmissionVolume
    Radius = 12
    IsHollow = Yes
  End
  Draw = DefaultDraw
  End`,
  },
  {
    label: 'Flash',
    detail: 'One bright, short, large flash, as at the heart of an explosion',
    body: `  System
    Priority = ALWAYS_RENDER
    ParticleName = \${2:flash.tga}
    Shader = ADDITIVE
    Lifetime = 8 8
    SystemLifetime = 1
    Size = 30 40
    BurstDelay = 1 1
    BurstCount = 1 1
    IsOneShot = Yes
  End
  Color = DefaultColor
    Color1 = R:255 G:250 B:220 0
    Color2 = R:255 G:160 B:60 8
  End
  Alpha = DefaultAlpha
    Alpha1 = 1.00 1.00 0
    Alpha2 = 0.00 0.00 8
  End
  Update = DefaultUpdate
    SizeRate = 2 3
    SizeRateDamping = 0.80 0.85
  End
  Physics = DefaultPhysics
  End
  EmissionVelocity = OrthoEmissionVelocity
  End
  EmissionVolume = PointEmissionVolume
  End
  Draw = DefaultDraw
  End`,
  },
];

/** Creates a template's snippet text: the name is the first tab stop, the texture the second */
export const templateSnippet = (template: ParticleTemplate, name: string) =>
  `FXParticleSystem \${1:${name}}\n${template.body}\nEnd\n`;
