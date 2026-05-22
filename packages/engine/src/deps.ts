import type { AdventureLoader } from './adventures/interface.js';
import type { BlobStore } from './blob/interface.js';
import type { IntentClassifier, LLMProvider } from './llm/provider.js';
import type { SessionStore } from './session-store/interface.js';

export interface EngineDependencies {
  sessionStore: SessionStore;
  adventureLoader: AdventureLoader;
  llmProvider: LLMProvider;
  blobStore: BlobStore;
  intentClassifier: IntentClassifier;
}
