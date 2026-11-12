import { GardenCase } from './garden-case';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: '园林花展布置与换花 · 幕景 Scendance',
  description: '在幕景自制的秋圃示范园里，从场地与布置走到补花变更和分岗交接。',
};

export default function GardenCasePage() {
  return <GardenCase />;
}
