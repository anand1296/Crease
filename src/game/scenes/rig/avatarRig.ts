import { Matrix4, type Object3D, Quaternion, Vector3 } from 'three';
import type { ClipData, Clips } from './avatarAssets.ts';
import type { Pose, RigFrames } from './Humanoid.tsx';

/**
 * Drives a skinned Rocketbox skeleton (3ds Max Biped, centimetres) either
 * from a motion-captured clip or from the procedural control rig
 * (`Humanoid`, hidden), transferring the rig's segment orientations onto the
 * model's bones. Switching source cross-fades over a quarter of a second.
 *
 * Retargeting: each limb bone gets a constant correction `R0` that turns the
 * bone from its bind (A-pose) orientation to "hanging straight down", which
 * is the control rig's zero pose; the bone's orientation is then the rig
 * segment's orientation times `R0`. Arms holding something are solved with
 * two-bone IK on the model itself so the hands land exactly on the target.
 */

const MAIN = [
  'Bip01', 'Bip01_Pelvis', 'Bip01_Spine', 'Bip01_Spine1', 'Bip01_Spine2', 'Bip01_Neck', 'Bip01_Head',
  'Bip01_L_Clavicle', 'Bip01_L_UpperArm', 'Bip01_L_Forearm', 'Bip01_L_Hand',
  'Bip01_R_Clavicle', 'Bip01_R_UpperArm', 'Bip01_R_Forearm', 'Bip01_R_Hand',
  'Bip01_L_Thigh', 'Bip01_L_Calf', 'Bip01_L_Foot', 'Bip01_L_Toe0',
  'Bip01_R_Thigh', 'Bip01_R_Calf', 'Bip01_R_Foot', 'Bip01_R_Toe0',
] as const;
type BoneName = (typeof MAIN)[number];

const FINGERS = ['1', '2', '3', '4'];
const FADE = 0.25;
const DOWN = new Vector3(0, -1, 0);
const I = new Quaternion();

interface BoneInfo {
  bone: Object3D;
  parent: BoneName | undefined;
  bindLocal: Quaternion;
  localPos: Vector3;
  /** Bind orientation in model space. */
  bindQ: Quaternion;
  /** Bind (A-pose) → hanging-down correction, limbs only. */
  r0: Quaternion | undefined;
}

const tq = new Quaternion();
const tq2 = new Quaternion();
const tv = new Vector3();
const tv2 = new Vector3();
const tv3 = new Vector3();
const tm = new Matrix4();
const basisX = new Vector3();
const basisY = new Vector3();
const basisZ = new Vector3();

export class AvatarRig {
  private readonly bones = new Map<BoneName, BoneInfo>();
  private readonly fingers: { bone: Object3D; bind: Quaternion; thumb: boolean; side: 'L' | 'R' }[] = [];
  /** World transform of Bip01's parent, model space (constant). */
  private readonly p0Q = new Quaternion();
  private readonly p0Pos = new Vector3();
  /** Working world orientations/positions in model space. */
  private readonly wq = new Map<BoneName, Quaternion>();
  private readonly wp = new Map<BoneName, Vector3>();
  /** Target and output local rotations. */
  private readonly target = new Map<BoneName, Quaternion>();
  private readonly out = new Map<BoneName, Quaternion>();
  private readonly from = new Map<BoneName, Quaternion>();
  private rootY = 89.5;
  private fromRootY = 89.5;
  private source = '';
  private fade = 1;
  private lastTime = -1;
  private readonly headFwd = new Vector3(0, 0, 1);

  private rootYOut = 89.5;

  constructor(
    model: Object3D,
    private readonly clips: Clips,
  ) {
    model.updateMatrixWorld(true);
    const byName = new Map<string, Object3D>();
    model.traverse((o) => {
      if (o.name.startsWith('Bip01')) byName.set(o.name, o);
    });
    for (const name of MAIN) {
      const bone = byName.get(name);
      if (!bone) throw new Error(`Avatar is missing bone ${name}`);
      const parentName = MAIN.find((n) => n === bone.parent?.name);
      const bindQ = new Quaternion();
      bone.matrixWorld.decompose(tv, bindQ, tv2);
      this.bones.set(name, { bone, parent: parentName, bindLocal: bone.quaternion.clone(), localPos: bone.position.clone(), bindQ, r0: undefined });
      this.wq.set(name, new Quaternion());
      this.wp.set(name, new Vector3());
      this.target.set(name, bone.quaternion.clone());
      this.out.set(name, bone.quaternion.clone());
      this.from.set(name, bone.quaternion.clone());
    }
    const bip = this.info('Bip01');
    bip.bone.parent?.matrixWorld.decompose(this.p0Pos, this.p0Q, tv);
    this.rootY = bip.bone.position.y;
    this.fromRootY = this.rootY;
    // Limb corrections.
    const limb = (b: BoneName, child: BoneName) => {
      const info = this.info(b);
      const a = new Vector3().setFromMatrixPosition(info.bone.matrixWorld);
      const c = new Vector3().setFromMatrixPosition(this.info(child).bone.matrixWorld);
      const dir = c.sub(a).normalize();
      info.r0 = new Quaternion().setFromUnitVectors(dir, DOWN).multiply(info.bindQ);
    };
    for (const s of ['L', 'R'] as const) {
      limb(`Bip01_${s}_UpperArm`, `Bip01_${s}_Forearm`);
      limb(`Bip01_${s}_Forearm`, `Bip01_${s}_Hand`);
      limb(`Bip01_${s}_Thigh`, `Bip01_${s}_Calf`);
      limb(`Bip01_${s}_Calf`, `Bip01_${s}_Foot`);
      const foot = this.info(`Bip01_${s}_Foot`);
      foot.r0 = foot.bindQ.clone();
      for (const f of ['0', ...FINGERS]) {
        for (const seg of ['', '1', '2']) {
          const bone = byName.get(`Bip01_${s}_Finger${f}${seg}`);
          if (bone) this.fingers.push({ bone, bind: bone.quaternion.clone(), thumb: f === '0', side: s });
        }
      }
    }
    const head = this.info('Bip01_Head');
    this.headFwd.set(0, 0, 1).applyQuaternion(head.bindQ.clone().invert());
  }

  private info(name: BoneName): BoneInfo {
    const b = this.bones.get(name);
    if (!b) throw new Error(name);
    return b;
  }

  private q(map: Map<BoneName, Quaternion>, name: BoneName): Quaternion {
    const v = map.get(name);
    if (!v) throw new Error(name);
    return v;
  }

  private p(name: BoneName): Vector3 {
    const v = this.wp.get(name);
    if (!v) throw new Error(name);
    return v;
  }

  /** Model-space hand position, metres in the character's space. */
  hand(side: 'L' | 'R', out: Vector3): Vector3 {
    return out.copy(this.p(`Bip01_${side}_Hand`)).multiplyScalar(0.01);
  }

  update(pose: Pose, frames: RigFrames, root: Object3D): void {
    const now = performance.now() / 1000;
    const dt = this.lastTime < 0 ? 0 : Math.min(0.1, now - this.lastTime);
    this.lastTime = now;

    const key = pose.clip ? `clip:${pose.clip.name}` : 'proc';
    if (key !== this.source) {
      if (this.source !== '') {
        for (const n of MAIN) this.q(this.from, n).copy(this.q(this.out, n));
        this.fromRootY = this.rootYOut;
        this.fade = 0;
      }
      this.source = key;
    }
    this.fade = Math.min(1, this.fade + dt / FADE);

    let targetRootY: number;
    if (pose.clip) {
      targetRootY = this.sampleClip(this.clips[pose.clip.name], pose.clip.time);
    } else {
      targetRootY = this.procedural(pose, frames, root);
    }

    // Cross-fade into the new source, then write the bones.
    const k = this.fade * this.fade * (3 - 2 * this.fade);
    for (const n of MAIN) {
      const o = this.q(this.out, n);
      if (k < 1) o.slerpQuaternions(this.q(this.from, n), this.q(this.target, n), k);
      else o.copy(this.q(this.target, n));
      this.info(n).bone.quaternion.copy(o);
    }
    this.rootYOut = this.fromRootY + (targetRootY - this.fromRootY) * k;
    const bip = this.info('Bip01').bone;
    bip.position.set(0, this.rootYOut, 0);
    if (pose.clip) {
      // Clip root positions are already in Bip01's parent space.
    } else {
      tv.set(0, this.rootYOut, 0).sub(this.p0Pos).applyQuaternion(tq.copy(this.p0Q).invert());
      bip.position.copy(tv);
    }
    this.grip(pose.grip ?? 0);
    // Keep world positions (for hands) in step with what is drawn.
    this.forward(this.out, bip.position);
  }

  /** Samples a clip into `target`; returns the root height (cm). */
  private sampleClip(clip: ClipData, time: number): number {
    const span = clip.duration;
    let t = clip.loop ? ((time % span) + span) % span : Math.min(span, Math.max(0, time));
    if (!Number.isFinite(t)) t = 0;
    const f = (t / span) * (clip.frames - 1);
    const i0 = Math.min(clip.frames - 1, Math.floor(f));
    const i1 = Math.min(clip.frames - 1, i0 + 1);
    const u = f - i0;
    for (const n of MAIN) {
      const tr = clip.tracks[n];
      const out = this.q(this.target, n);
      if (!tr) {
        out.copy(this.info(n).bindLocal);
        continue;
      }
      tq.set(tr[i0 * 4] ?? 0, tr[i0 * 4 + 1] ?? 0, tr[i0 * 4 + 2] ?? 0, tr[i0 * 4 + 3] ?? 1);
      tq2.set(tr[i1 * 4] ?? 0, tr[i1 * 4 + 1] ?? 0, tr[i1 * 4 + 2] ?? 0, tr[i1 * 4 + 3] ?? 1);
      out.slerpQuaternions(tq, tq2, u);
    }
    const h0 = clip.height[i0] ?? 0.895;
    const h1 = clip.height[i1] ?? h0;
    return (h0 + (h1 - h0) * u) * 100;
  }

  /** Forward kinematics over MAIN from local rotations; fills `wq`/`wp` (model space, cm). */
  private forward(locals: Map<BoneName, Quaternion>, rootLocalPos: Vector3): void {
    for (const n of MAIN) {
      const info = this.info(n);
      const local = this.q(locals, n);
      const wq = this.q(this.wq, n);
      const wp = this.p(n);
      if (!info.parent) {
        wq.copy(this.p0Q).multiply(local);
        wp.copy(rootLocalPos).applyQuaternion(this.p0Q).add(this.p0Pos);
      } else {
        const pq = this.q(this.wq, info.parent);
        wq.copy(pq).multiply(local);
        wp.copy(info.localPos).applyQuaternion(pq).add(this.p(info.parent));
      }
    }
  }

  /** Sets world orientation of `n` (parent's world must be current) and records its local. */
  private setWorld(n: BoneName, world: Quaternion): void {
    const info = this.info(n);
    const wq = this.q(this.wq, n);
    wq.copy(world);
    const parentQ = info.parent ? this.q(this.wq, info.parent) : this.p0Q;
    this.q(this.target, n).copy(parentQ).invert().multiply(world);
    const wp = this.p(n);
    if (info.parent) wp.copy(info.localPos).applyQuaternion(this.q(this.wq, info.parent)).add(this.p(info.parent));
  }

  /** Keeps the bind local rotation of `n` under its (already posed) parent. */
  private keepBind(n: BoneName): void {
    const info = this.info(n);
    const parentQ = info.parent ? this.q(this.wq, info.parent) : this.p0Q;
    this.setWorld(n, tq.copy(parentQ).multiply(info.bindLocal));
  }

  private procedural(pose: Pose, f: RigFrames, root: Object3D): number {
    const rootY = f.hipsY * 100;
    // Root.
    const bip = this.info('Bip01');
    this.q(this.target, 'Bip01').copy(bip.bindLocal);
    this.q(this.wq, 'Bip01').copy(this.p0Q).multiply(bip.bindLocal);
    this.p('Bip01').set(0, rootY, 0);
    this.keepBind('Bip01_Pelvis');
    // Spine: the rig's torso rotation shared over three vertebrae.
    const spine: [BoneName, number][] = [['Bip01_Spine', 1 / 3], ['Bip01_Spine1', 2 / 3], ['Bip01_Spine2', 1]];
    for (const [n, k] of spine) this.setWorld(n, tq.slerpQuaternions(I, f.torso, k).multiply(this.info(n).bindQ));
    this.setWorld('Bip01_Neck', tq.copy(f.torso).multiply(this.info('Bip01_Neck').bindQ));
    // Head steadier than the trunk (as a batter's is), and turned to what it is looking at.
    const head = tq2.slerpQuaternions(I, f.torso, 0.55).multiply(this.info('Bip01_Head').bindQ);
    if (pose.look) {
      const headPos = tv3.copy(this.info('Bip01_Head').localPos).applyQuaternion(this.q(this.wq, 'Bip01_Neck')).add(this.p('Bip01_Neck'));
      const target = tv.copy(pose.look);
      root.worldToLocal(target).multiplyScalar(100).sub(headPos);
      target.y *= 0.6;
      if (target.lengthSq() > 1) {
        target.normalize();
        const fwd = tv2.copy(this.headFwd).applyQuaternion(head);
        const turn = tq.setFromUnitVectors(fwd, target);
        // Limit how far the head can turn.
        const angle = 2 * Math.acos(Math.min(1, Math.abs(turn.w)));
        if (angle > 1.3) turn.slerp(I, 1 - 1.3 / angle);
        head.premultiply(turn);
      }
    }
    this.setWorld('Bip01_Head', head);

    for (const s of ['L', 'R'] as const) {
      this.keepBind(`Bip01_${s}_Clavicle`);
      const ua = this.info(`Bip01_${s}_UpperArm`);
      const fa = this.info(`Bip01_${s}_Forearm`);
      const target = s === 'L' ? pose.handL : pose.handR;
      const upperFrame = s === 'L' ? f.upperArmL : f.upperArmR;
      const foreFrame = s === 'L' ? f.forearmL : f.forearmR;
      if (target && ua.r0 && fa.r0) {
        // Two-bone IK on the model's own arm, elbow towards the rig's elbow.
        this.setWorld(`Bip01_${s}_UpperArm`, tq.copy(upperFrame).multiply(ua.r0));
        const shoulder = this.p(`Bip01_${s}_UpperArm`);
        const goal = tv.copy(target);
        root.worldToLocal(goal).multiplyScalar(100);
        const pole = tv2.copy(s === 'L' ? f.elbowL : f.elbowR).multiplyScalar(100);
        this.solveArm(s, shoulder, goal, pole);
      } else {
        if (ua.r0) this.setWorld(`Bip01_${s}_UpperArm`, tq.copy(upperFrame).multiply(ua.r0));
        if (fa.r0) this.setWorld(`Bip01_${s}_Forearm`, tq.copy(foreFrame).multiply(fa.r0));
      }
      this.keepBind(`Bip01_${s}_Hand`);
    }
    for (const s of ['L', 'R'] as const) {
      const th = this.info(`Bip01_${s}_Thigh`);
      const ca = this.info(`Bip01_${s}_Calf`);
      const ft = this.info(`Bip01_${s}_Foot`);
      if (th.r0) this.setWorld(`Bip01_${s}_Thigh`, tq.copy(s === 'L' ? f.thighL : f.thighR).multiply(th.r0));
      if (ca.r0) this.setWorld(`Bip01_${s}_Calf`, tq.copy(s === 'L' ? f.calfL : f.calfR).multiply(ca.r0));
      if (ft.r0) this.setWorld(`Bip01_${s}_Foot`, tq.copy(s === 'L' ? f.footL : f.footR).multiply(ft.r0));
      this.keepBind(`Bip01_${s}_Toe0`);
    }
    return rootY;
  }

  private solveArm(s: 'L' | 'R', shoulder: Vector3, goal: Vector3, pole: Vector3): void {
    const ua = this.info(`Bip01_${s}_UpperArm`);
    const fa = this.info(`Bip01_${s}_Forearm`);
    const a = this.info(`Bip01_${s}_Forearm`).localPos.length();
    const b = this.info(`Bip01_${s}_Hand`).localPos.length();
    const toGoal = tv3.copy(goal).sub(shoulder);
    const d = Math.min(a + b - 0.5, Math.max(Math.abs(a - b) + 0.5, toGoal.length()));
    const u = toGoal.normalize();
    // Bend direction: towards the pole, perpendicular to the shoulder→goal line.
    const n = basisZ.copy(pole).sub(shoulder);
    n.addScaledVector(u, -n.dot(u));
    if (n.lengthSq() < 1e-6) n.set(0, 0, 1).addScaledVector(u, -u.z);
    n.normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const dirU = basisY.copy(u).multiplyScalar(cosA).addScaledVector(n, sinA).normalize();
    const elbow = tv.copy(shoulder).addScaledVector(dirU, a);
    const dirF = tv2.copy(shoulder).addScaledVector(u, d).sub(elbow).normalize();
    // Frames as the control rig would build them: y' = −bone, z' = side the forearm bends to.
    const frame = (along: Vector3, bendTo: Vector3, out: Quaternion) => {
      const y = tv3.copy(along).negate();
      const z = basisZ.copy(bendTo).addScaledVector(along, -bendTo.dot(along));
      if (z.lengthSq() < 1e-8) z.copy(n);
      z.normalize();
      const x = basisX.crossVectors(y, z).normalize();
      z.crossVectors(x, y);
      tm.makeBasis(x, y, z);
      return out.setFromRotationMatrix(tm);
    };
    if (!ua.r0 || !fa.r0) return;
    const uq = frame(dirU, dirF, new Quaternion());
    this.setWorld(`Bip01_${s}_UpperArm`, uq.multiply(ua.r0));
    // Forearm frame: same hinge axis as the upper arm's.
    const hinge = basisX.set(1, 0, 0).applyQuaternion(frame(dirU, dirF, tq2));
    const y = tv3.copy(dirF).negate();
    const z = basisZ.crossVectors(hinge, y).normalize();
    tm.makeBasis(hinge, y, z);
    const fq = new Quaternion().setFromRotationMatrix(tm);
    this.setWorld(`Bip01_${s}_Forearm`, fq.multiply(fa.r0));
  }

  /** Curls the fingers (and folds the thumb) by `amount` 0–1. */
  private grip(amount: number): void {
    for (const f of this.fingers) {
      if (amount <= 0.001) {
        f.bone.quaternion.copy(f.bind);
        continue;
      }
      const angle = (f.thumb ? 0.5 : 1.25) * amount;
      tq.setFromAxisAngle(tv.set(0, 0, 1), -angle);
      f.bone.quaternion.copy(f.bind).multiply(tq);
    }
  }
}
