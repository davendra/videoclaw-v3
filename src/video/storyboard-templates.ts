export interface StoryboardPanelTemplate {
  sceneIndex: number;
  shotType: string;
  purpose: string;
  descriptionTemplate: string;
}

export interface StoryboardTemplate {
  id: string;
  name: string;
  description: string;
  emotionalArc: string;
  bestFor: string[];
  minCharacters: number;
  panels: StoryboardPanelTemplate[];
}

export interface BuildStoryboardFromTemplateInput {
  templateId: string;
  environment?: string;
  characterA?: string;
  characterB?: string;
}

function fillTemplate(
  template: string,
  input: { environment: string; characterA: string; characterB: string },
): string {
  return template
    .replaceAll('{environment}', input.environment)
    .replaceAll('{characterA}', input.characterA)
    .replaceAll('{characterB}', input.characterB);
}

const STORYBOARD_TEMPLATES: StoryboardTemplate[] = [
  {
    id: 'dialogue-confrontation',
    name: 'Dialogue Confrontation',
    description: 'Two-character tension build with decision-point coverage.',
    emotionalArc: 'Tension -> breaking point -> resolution',
    bestFor: ['arguments', 'negotiations', 'dramatic conversations', 'decisions'],
    minCharacters: 2,
    panels: [
      { sceneIndex: 0, shotType: 'wide establishing', purpose: 'context', descriptionTemplate: 'Wide establishing shot of {characterA} and {characterB} in {environment}, emphasizing distance and tension.' },
      { sceneIndex: 1, shotType: 'medium A', purpose: 'state', descriptionTemplate: 'Medium shot on {characterA}, posture tense, eyes fixed on {characterB} in {environment}.' },
      { sceneIndex: 2, shotType: 'medium B', purpose: 'counterpoint', descriptionTemplate: 'Medium shot on {characterB}, guarded and uncertain, framed against {environment}.' },
      { sceneIndex: 3, shotType: 'close A', purpose: 'reaction', descriptionTemplate: 'Tight close-up on {characterA} as emotion breaks through restraint.' },
      { sceneIndex: 4, shotType: 'insert', purpose: 'symbol', descriptionTemplate: 'Insert shot of a symbolic object or environmental detail in {environment} that sharpens the conflict.' },
      { sceneIndex: 5, shotType: 'close B', purpose: 'counter-reaction', descriptionTemplate: 'Tight close-up on {characterB} processing the stakes of the confrontation.' },
      { sceneIndex: 6, shotType: 'high wide', purpose: 'stakes', descriptionTemplate: 'High-angle wide shot of both characters in {environment}, making them feel small against the stakes.' },
      { sceneIndex: 7, shotType: 'two-shot', purpose: 'dynamic', descriptionTemplate: 'Two-shot of {characterA} and {characterB} with visible space and unresolved tension between them.' },
      { sceneIndex: 8, shotType: 'wide exit', purpose: 'resolution', descriptionTemplate: 'Wide resolution shot of one or both characters moving forward, leaving something behind in {environment}.' },
    ],
  },
  {
    id: 'chase-pursuit',
    name: 'Chase Pursuit',
    description: 'Urgent motion language for pursuit, escape, or physical race sequences.',
    emotionalArc: 'Urgency -> escalation -> climax',
    bestFor: ['escapes', 'races', 'being followed', 'physical conflict'],
    minCharacters: 1,
    panels: [
      { sceneIndex: 0, shotType: 'wide establishing', purpose: 'arena', descriptionTemplate: 'Wide establishing shot of the chase arena in {environment}, with {characterA} already in motion.' },
      { sceneIndex: 1, shotType: 'tracking medium', purpose: 'momentum', descriptionTemplate: 'Tracking medium shot beside {characterA} sprinting through {environment} with visible urgency.' },
      { sceneIndex: 2, shotType: 'over-shoulder', purpose: 'threat', descriptionTemplate: 'Over-shoulder shot from {characterA} looking back at the threat or pursuer gaining ground in {environment}.' },
      { sceneIndex: 3, shotType: 'detail close-up', purpose: 'strain', descriptionTemplate: 'Detail close-up of feet, hands, or impact points showing the physical strain of the chase.' },
      { sceneIndex: 4, shotType: 'insert', purpose: 'obstacle', descriptionTemplate: 'Insert shot of a critical obstacle or goal object that defines the next beat of the chase.' },
      { sceneIndex: 5, shotType: 'face close-up', purpose: 'fear', descriptionTemplate: 'Tight close-up of {characterA} showing fear, exhaustion, or determination.' },
      { sceneIndex: 6, shotType: 'low angle', purpose: 'pressure', descriptionTemplate: 'Low-angle shot that makes the pursuing force or danger feel dominant and inescapable.' },
      { sceneIndex: 7, shotType: 'action two-shot', purpose: 'near catch', descriptionTemplate: 'Action two-shot where {characterA} and the threat nearly collide or the gap narrows dramatically.' },
      { sceneIndex: 8, shotType: 'wide resolution', purpose: 'outcome', descriptionTemplate: 'Wide outcome shot showing whether {characterA} escapes, is cornered, or enters the next danger zone.' },
    ],
  },
  {
    id: 'discovery-reveal',
    name: 'Discovery Reveal',
    description: 'Mystery and reveal structure for secrets, twists, or important finds.',
    emotionalArc: 'Mystery -> investigation -> revelation',
    bestFor: ['finding something', 'plot twists', 'mysteries', 'secret reveals'],
    minCharacters: 1,
    panels: [
      { sceneIndex: 0, shotType: 'wide establishing', purpose: 'mystery setup', descriptionTemplate: 'Wide shot of {characterA} entering {environment}, with an unsettling or mysterious tone.' },
      { sceneIndex: 1, shotType: 'medium search', purpose: 'investigation', descriptionTemplate: 'Medium shot of {characterA} moving through {environment}, actively searching for clues.' },
      { sceneIndex: 2, shotType: 'reaction close-up', purpose: 'notice detail', descriptionTemplate: 'Close-up of {characterA} noticing something unexpected or out of place.' },
      { sceneIndex: 3, shotType: 'POV approach', purpose: 'approach', descriptionTemplate: 'Point-of-view style shot approaching the source of the mystery in {environment}.' },
      { sceneIndex: 4, shotType: 'insert reveal', purpose: 'reveal', descriptionTemplate: 'Insert reveal of the crucial object, clue, or secret that changes the scene.' },
      { sceneIndex: 5, shotType: 'extreme close-up', purpose: 'impact', descriptionTemplate: 'Extreme close-up of {characterA} as the meaning of the reveal lands emotionally.' },
      { sceneIndex: 6, shotType: 'wide context', purpose: 'implications', descriptionTemplate: 'Wide context shot of {characterA} with the discovery, showing how it changes the room or situation.' },
      { sceneIndex: 7, shotType: 'decision medium', purpose: 'decision', descriptionTemplate: 'Medium shot of {characterA} making a new decision after the reveal.' },
      { sceneIndex: 8, shotType: 'wide departure', purpose: 'new trajectory', descriptionTemplate: 'Wide departure shot showing {characterA} leaving {environment} with new purpose.' },
    ],
  },
  {
    id: 'product-story',
    name: 'Product Story',
    description: 'Problem-solution commercial structure centered on discovering and using a product.',
    emotionalArc: 'Problem -> discovery -> transformation',
    bestFor: ['commercials', 'product narratives', 'before/after', 'testimonials'],
    minCharacters: 1,
    panels: [
      { sceneIndex: 0, shotType: 'wide problem', purpose: 'pain point', descriptionTemplate: 'Wide shot of {characterA} struggling with a clear problem in {environment}.' },
      { sceneIndex: 1, shotType: 'close frustration', purpose: 'emotion', descriptionTemplate: 'Close-up on {characterA} showing frustration, inconvenience, or fatigue.' },
      { sceneIndex: 2, shotType: 'insert product', purpose: 'introduction', descriptionTemplate: 'Clean insert shot revealing the product that may solve the problem.' },
      { sceneIndex: 3, shotType: 'medium discovery', purpose: 'discovery', descriptionTemplate: 'Medium shot of {characterA} discovering or picking up the product in {environment}.' },
      { sceneIndex: 4, shotType: 'detail use', purpose: 'usage detail', descriptionTemplate: 'Detail shot of hands interacting with the product in a clear, readable way.' },
      { sceneIndex: 5, shotType: 'medium use', purpose: 'active use', descriptionTemplate: 'Medium shot of {characterA} actively using the product with confidence.' },
      { sceneIndex: 6, shotType: 'close satisfaction', purpose: 'benefit', descriptionTemplate: 'Close-up on {characterA} as the benefit lands and satisfaction becomes visible.' },
      { sceneIndex: 7, shotType: 'wide transformed', purpose: 'after state', descriptionTemplate: 'Wide shot of {characterA} in an improved situation made possible by the product.' },
      { sceneIndex: 8, shotType: 'hero finale', purpose: 'finish', descriptionTemplate: 'Hero finale shot of the product and {characterA}, clean and campaign-ready.' },
    ],
  },
  {
    id: 'beat-structure-3',
    name: 'Beat Structure — 3 scene',
    description: 'Minimal Establish → Develop → Payoff beat structure for short-form narrative and ads (Seedance handbook beat structure).',
    emotionalArc: 'Setup → escalation → resolution',
    bestFor: ['short ads', 'social cuts', 'quick narratives', 'one-take stories', 'punchlines'],
    minCharacters: 1,
    panels: [
      { sceneIndex: 0, shotType: 'establish', purpose: 'establish', descriptionTemplate: 'Establish: wide or medium shot that introduces {characterA} and the situation in {environment}.' },
      { sceneIndex: 1, shotType: 'develop', purpose: 'develop', descriptionTemplate: 'Develop: medium or close shot that escalates the situation — a meaningful change in stakes, action, or intent for {characterA} in {environment}.' },
      { sceneIndex: 2, shotType: 'payoff', purpose: 'payoff', descriptionTemplate: 'Payoff: the shot that delivers the outcome, reveal, or emotional landing — clean and readable.' },
    ],
  },
  {
    id: 'beat-structure-6',
    name: 'Beat Structure — 6 scene',
    description: 'Two shots per beat — Establish / Develop / Payoff — for mid-length narrative, educational explainers, and product sequences (Seedance handbook beat structure).',
    emotionalArc: 'Setup → escalation → resolution with breathing room',
    bestFor: ['explainers', 'product launches', 'transformations', 'before/after', 'educational sequences'],
    minCharacters: 1,
    panels: [
      { sceneIndex: 0, shotType: 'establish wide', purpose: 'establish-context', descriptionTemplate: 'Establish wide: context shot of {characterA} in {environment}, introducing the situation.' },
      { sceneIndex: 1, shotType: 'establish detail', purpose: 'establish-detail', descriptionTemplate: 'Establish detail: medium or insert shot anchoring the specific element, object, or intent {characterA} is focused on.' },
      { sceneIndex: 2, shotType: 'develop action', purpose: 'develop-action', descriptionTemplate: 'Develop action: medium shot of {characterA} taking the meaningful action that changes the situation in {environment}.' },
      { sceneIndex: 3, shotType: 'develop consequence', purpose: 'develop-consequence', descriptionTemplate: 'Develop consequence: close-up or detail showing the immediate consequence of the action — visible change, reaction, or progress.' },
      { sceneIndex: 4, shotType: 'payoff reveal', purpose: 'payoff-reveal', descriptionTemplate: 'Payoff reveal: the moment the outcome lands — clean and readable, framed for maximum impact.' },
      { sceneIndex: 5, shotType: 'payoff resolve', purpose: 'payoff-resolve', descriptionTemplate: 'Payoff resolve: final shot of {characterA} in the new state, closing the beat structure.' },
    ],
  },
  {
    id: 'product-commercial-4',
    name: 'Product Commercial — 4 scene',
    description: 'Compact problem, product, use, payoff structure for short commercials.',
    emotionalArc: 'Need -> reveal -> proof -> desire',
    bestFor: ['short ads', 'launch teasers', 'UGC product spots', 'before/after'],
    minCharacters: 1,
    panels: [
      { sceneIndex: 0, shotType: 'problem hook', purpose: 'need', descriptionTemplate: 'Problem hook: {characterA} faces one clear friction point in {environment}, readable in a single action.' },
      { sceneIndex: 1, shotType: 'product reveal', purpose: 'reveal', descriptionTemplate: 'Product reveal: clean hero shot of the product entering frame with simple, premium composition.' },
      { sceneIndex: 2, shotType: 'usage proof', purpose: 'proof', descriptionTemplate: 'Usage proof: {characterA} uses the product once in {environment}, with the benefit visible on screen.' },
      { sceneIndex: 3, shotType: 'payoff hero', purpose: 'desire', descriptionTemplate: 'Payoff hero: final product-and-person shot showing the improved state, confident and uncluttered.' },
    ],
  },
  {
    id: 'food-tutorial-6',
    name: 'Food Tutorial — 6 scene',
    description: 'Stepwise ingredient, action, transformation, and final bite template.',
    emotionalArc: 'Curiosity -> method -> appetite',
    bestFor: ['recipe clips', 'cooking tutorials', 'food prep', 'creator shorts'],
    minCharacters: 1,
    panels: [
      { sceneIndex: 0, shotType: 'ingredient overview', purpose: 'setup', descriptionTemplate: 'Ingredient overview: organized food and tools in {environment}, with {characterA} ready to begin.' },
      { sceneIndex: 1, shotType: 'prep detail', purpose: 'prep', descriptionTemplate: 'Prep detail: hands complete one clear prep action, framed close enough to understand the technique.' },
      { sceneIndex: 2, shotType: 'mix or season', purpose: 'method', descriptionTemplate: 'Mix or season: {characterA} adds flavor or combines ingredients with visible texture and motion.' },
      { sceneIndex: 3, shotType: 'heat transformation', purpose: 'transformation', descriptionTemplate: 'Heat transformation: cooking action shows steam, sizzle, melt, or color change in {environment}.' },
      { sceneIndex: 4, shotType: 'plate reveal', purpose: 'reveal', descriptionTemplate: 'Plate reveal: finished dish appears cleanly arranged, with the most appetizing detail in focus.' },
      { sceneIndex: 5, shotType: 'taste payoff', purpose: 'payoff', descriptionTemplate: 'Taste payoff: {characterA} reacts naturally after one bite, closing on satisfaction and food texture.' },
    ],
  },
  {
    id: 'dance-social-6',
    name: 'Dance Social — 6 scene',
    description: 'Rhythmic short-form dance structure with hook, moves, and loopable finish.',
    emotionalArc: 'Anticipation -> energy -> replay',
    bestFor: ['dance trends', 'music promos', 'social shorts', 'creator choreography'],
    minCharacters: 1,
    panels: [
      { sceneIndex: 0, shotType: 'pose hook', purpose: 'hook', descriptionTemplate: 'Pose hook: {characterA} holds a distinct starting pose in {environment}, ready for the beat to drop.' },
      { sceneIndex: 1, shotType: 'first move', purpose: 'launch', descriptionTemplate: 'First move: {characterA} starts the choreography with one bold, readable movement.' },
      { sceneIndex: 2, shotType: 'footwork detail', purpose: 'precision', descriptionTemplate: 'Footwork detail: close framing highlights rhythm, steps, and clean timing without changing the setting.' },
      { sceneIndex: 3, shotType: 'signature move', purpose: 'identity', descriptionTemplate: 'Signature move: {characterA} performs the most memorable gesture or transition in {environment}.' },
      { sceneIndex: 4, shotType: 'energy lift', purpose: 'escalation', descriptionTemplate: 'Energy lift: movement becomes bigger and more expressive while the framing stays easy to follow.' },
      { sceneIndex: 5, shotType: 'loop finish', purpose: 'replay', descriptionTemplate: 'Loop finish: {characterA} lands on a final pose that can cut smoothly back to the opening.' },
    ],
  },
  {
    id: 'dramatic-short-6',
    name: 'Dramatic Short — 6 scene',
    description: 'Concise emotional scene with reveal, choice, and aftermath.',
    emotionalArc: 'Unease -> confrontation -> consequence',
    bestFor: ['micro drama', 'character moments', 'twists', 'relationship tension'],
    minCharacters: 1,
    panels: [
      { sceneIndex: 0, shotType: 'quiet establish', purpose: 'setup', descriptionTemplate: 'Quiet establish: {characterA} enters {environment}, with tension visible in posture and silence.' },
      { sceneIndex: 1, shotType: 'important detail', purpose: 'clue', descriptionTemplate: 'Important detail: close shot of the object, message, or gesture that changes the emotional stakes.' },
      { sceneIndex: 2, shotType: 'reaction close-up', purpose: 'reaction', descriptionTemplate: 'Reaction close-up: {characterA} absorbs the discovery, holding emotion in the face and eyes.' },
      { sceneIndex: 3, shotType: 'decision beat', purpose: 'choice', descriptionTemplate: 'Decision beat: {characterA} takes one decisive action in {environment}, shifting the scene forward.' },
      { sceneIndex: 4, shotType: 'confrontation', purpose: 'pressure', descriptionTemplate: 'Confrontation: {characterA} faces {characterB} or the consequence directly, with clear spatial tension.' },
      { sceneIndex: 5, shotType: 'aftermath', purpose: 'landing', descriptionTemplate: 'Aftermath: final quiet image shows what changed for {characterA}, restrained and emotionally legible.' },
    ],
  },
  {
    id: 'action-short-6',
    name: 'Action Short — 6 scene',
    description: 'Fast physical sequence with setup, obstacle, impact, and escape beat.',
    emotionalArc: 'Threat -> acceleration -> release',
    bestFor: ['action teasers', 'stunts', 'sports clips', 'escape scenes'],
    minCharacters: 1,
    panels: [
      { sceneIndex: 0, shotType: 'threat setup', purpose: 'stakes', descriptionTemplate: 'Threat setup: {characterA} spots the danger or objective in {environment}, with stakes clear immediately.' },
      { sceneIndex: 1, shotType: 'launch move', purpose: 'start', descriptionTemplate: 'Launch move: {characterA} commits to one fast physical action, framed for direction and momentum.' },
      { sceneIndex: 2, shotType: 'obstacle beat', purpose: 'obstacle', descriptionTemplate: 'Obstacle beat: the path is blocked by a visible barrier, rival, or hazard in {environment}.' },
      { sceneIndex: 3, shotType: 'impact detail', purpose: 'intensity', descriptionTemplate: 'Impact detail: close shot of contact, landing, grip, or equipment strain that sells the action safely.' },
      { sceneIndex: 4, shotType: 'near miss', purpose: 'climax', descriptionTemplate: 'Near miss: {characterA} barely clears the danger or closes the distance with precise timing.' },
      { sceneIndex: 5, shotType: 'escape wide', purpose: 'release', descriptionTemplate: 'Escape wide: final wide shot shows {characterA} reaching a new position or surviving the beat.' },
    ],
  },
];

export function listStoryboardTemplates(): StoryboardTemplate[] {
  return STORYBOARD_TEMPLATES;
}

export function readStoryboardTemplate(id: string): StoryboardTemplate | null {
  return STORYBOARD_TEMPLATES.find((template) => template.id === id) ?? null;
}

export function buildStoryboardScenesFromTemplate(
  input: BuildStoryboardFromTemplateInput,
): Array<{ sceneIndex: number; description: string }> {
  const template = readStoryboardTemplate(input.templateId);
  if (!template) {
    throw new Error(`Storyboard template "${input.templateId}" not found.`);
  }

  const environment = input.environment?.trim() || 'a cinematic environment';
  const characterA = input.characterA?.trim() || 'Character A';
  const characterB = input.characterB?.trim() || 'Character B';

  return template.panels.map((panel) => ({
    sceneIndex: panel.sceneIndex,
    description: fillTemplate(panel.descriptionTemplate, {
      environment,
      characterA,
      characterB,
    }),
  }));
}
