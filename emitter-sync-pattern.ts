/* Check the comments first */

import {EventEmitter} from "./emitter";
import {EVENT_SAVE_DELAY_MS, EventDelayedRepository} from "./event-repository";
import {EventStatistics} from "./event-statistics";
import {ResultsTester} from "./results-tester";
import {triggerRandomly} from "./utils";
import { Mutex } from "async-mutex";

const MAX_EVENTS = 1000;

enum EventName {
  EventA = "A",
  EventB = "B",
}

const EVENT_NAMES = [EventName.EventA, EventName.EventB];

/*

  An initial configuration for this case

*/

function init() {
  const emitter = new EventEmitter<EventName>();

  triggerRandomly(() => emitter.emit(EventName.EventA), MAX_EVENTS);
  triggerRandomly(() => emitter.emit(EventName.EventB), MAX_EVENTS);

  const repository = new EventRepository();
  const handler = new EventHandler(emitter, repository);

  const resultsTester = new ResultsTester({
    eventNames: EVENT_NAMES,
    emitter,
    handler,
    repository,
  });
  resultsTester.showStats(20);
}

/* Please do not change the code above this line */
/* ----–––––––––––––––––––––––––––––––––––––---- */

/*

  The implementation of EventHandler and EventRepository is up to you.
  Main idea is to subscribe to EventEmitter, save it in local stats
  along with syncing with EventRepository.

  The implementation of EventHandler and EventRepository is flexible and left to your discretion.
  The primary objective is to subscribe to EventEmitter, record the events in `.eventStats`,
  and ensure synchronization with EventRepository.

  The ultimate aim is to have the `.eventStats` of EventHandler and EventRepository
  have the same values (and equal to the actual events fired by the emitter) by the
  time MAX_EVENTS have been fired.

*/

class EventHandler extends EventStatistics<EventName> {
  repository: EventRepository;
  private pendingEvents: Map<EventName, number>;
  private mutex: Mutex;

  constructor(emitter: EventEmitter<EventName>, repository: EventRepository) {
    super()
    this.repository = repository;
    this.pendingEvents = new Map();
    this.mutex = new Mutex();

    EVENT_NAMES.forEach(eventName => {
      emitter.subscribe(eventName, () => this.handleEvent(eventName));
    });


    setInterval(async () => {
      await this.mutex.runExclusive(async () => {
        for (const eventName of EVENT_NAMES) {
          const pendingEvents = this.pendingEvents.get(eventName);
          if (pendingEvents && pendingEvents > 0) {
            try {
              await this.synchronize(eventName, pendingEvents);
              this.pendingEvents.set(eventName, 0);
            } catch (e) {
              console.error(`Failed to synchronize ${eventName}:`, e);
            }
          }
        }
      });
    }, 2000);
  }

  async synchronize(eventName: EventName, by: number) {
    try {
      await this.repository.saveEventData(eventName, by);
      console.log(`Successfully synchronized ${eventName} with ${by} events.`);
    } catch (error) {
      console.error(`Error synchronizing ${eventName}:`, error);
    }
  }

  handleEvent(eventName: EventName) {
    this.setStats(eventName, this.getStats(eventName) + 1);

    this.mutex.runExclusive(() => {
      this.pendingEvents.set(eventName, (this.pendingEvents.get(eventName) || 0) + 1);
    }).catch(err => {
      console.error(`Error in mutex operation: ${err}`);
    });
  }
}

class EventRepository extends EventDelayedRepository<EventName> {
  // Feel free to edit this class
  private rateLimitInterval = EVENT_SAVE_DELAY_MS;
  private lastRequestTime = 0;

  async saveEventData(eventName: EventName, by: number) {
    let attempts = 0;
    const maxAttempts = 5;
    const baseDelay = 2000;

    while (attempts < maxAttempts) {
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequestTime;

      if (timeSinceLastRequest < this.rateLimitInterval) {
        const delay = this.rateLimitInterval - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      try {
        await this.updateEventStatsBy(eventName, by);
        this.lastRequestTime = Date.now();
        break;
      } catch (e) {
        attempts++;
        if (e.includes("Too many requests")) {
          const retryDelay = baseDelay * Math.pow(2, attempts);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
          console.warn(e);
          break;
        }
      }
    }
  }
}

init();
