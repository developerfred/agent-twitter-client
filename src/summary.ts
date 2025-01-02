import { Scraper } from './scraper';
import type { Tweet } from './tweets';
import type { Profile } from './profile';

export interface AnalysisPeriod {
    readonly start: Date;
    readonly end: Date;
}

export interface BulletSummary {
    readonly user: string;
    readonly points: ReadonlyArray<string>;
}

export interface KeywordConfig {
    readonly maxBulletPoints: number;
    readonly minEngagement: number;
    readonly commonWords: ReadonlySet<string>;
}

export type UserIdentifier = {
    userId?: string;
    screenName?: string;
};

export class TweetAnalyzer {
    private static readonly DEFAULT_CONFIG: Readonly<KeywordConfig> = {
        maxBulletPoints: 5,
        minEngagement: 50,
        commonWords: new Set([
            'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'it',
            'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at', 'this'
        ])
    };

    constructor(
        private readonly scraper: Scraper,
        private readonly config: KeywordConfig = TweetAnalyzer.DEFAULT_CONFIG
    ) { }

    public async getFeedSummary(
        user: string | UserIdentifier,
        period: AnalysisPeriod,
        maxFollows = 100
    ): Promise<ReadonlyArray<BulletSummary>> {
        const userId = await this.resolveUserId(user);
        if (!userId) {
            throw new Error('Could not resolve user identifier');
        }
        const follows = await this.getFollowedUsers(userId, maxFollows);
        return this.generateBulletPoints(follows, period);
    }

    private async resolveUserId(user: string | UserIdentifier): Promise<string | null> {
        if (typeof user === 'string') {
            // Try to resolve as screen name first
            try {
                return await this.scraper.getUserIdByScreenName(user);
            } catch {
                // If it fails, maybe it was a userId already
                return user;
            }
        }

        if (user.userId) {
            return user.userId;
        }

        if (user.screenName) {
            return await this.scraper.getUserIdByScreenName(user.screenName);
        }

        return null;
    }

    private async getFollowedUsers(
        userId: string,
        maxFollows: number
    ): Promise<ReadonlyArray<Profile>> {
        const follows: Profile[] = [];
        for await (const follow of this.scraper.getFollowing(userId, maxFollows)) {
            follows.push(follow);
        }
        return follows;
    }

    private async getTimelineTweets(
        userId: string,
        period: AnalysisPeriod
    ): Promise<ReadonlyArray<Tweet>> {
        const tweets: Tweet[] = [];
        for await (const tweet of this.scraper.getTweetsByUserId(userId, 200)) {
            if (tweet.timeParsed && this.isWithinPeriod(tweet.timeParsed, period)) {
                tweets.push(tweet);
            }
        }
        return tweets;
    }

    private async generateBulletPoints(
        follows: ReadonlyArray<Profile>,
        period: AnalysisPeriod
    ): Promise<ReadonlyArray<BulletSummary>> {
        const summaries: BulletSummary[] = [];

        for (const follow of follows) {
            if (!follow.userId) continue;
            const tweets = await this.getTimelineTweets(follow.userId, period);
            if (tweets.length > 0 && follow.username) {
                const points = this.summarizeTweets(tweets);
                summaries.push({ user: follow.username, points });
            }
        }

        return summaries;
    }

    private summarizeTweets(tweets: ReadonlyArray<Tweet>): ReadonlyArray<string> {
        const points: string[] = [];

        // Most engaged tweets
        const topTweets = tweets
            .filter(t => ((t.likes ?? 0) + (t.retweets ?? 0)) > this.config.minEngagement)
            .sort((a, b) => ((b.likes ?? 0) + (b.retweets ?? 0)) - ((a.likes ?? 0) + (a.retweets ?? 0)))
            .slice(0, 3);

        for (const tweet of topTweets) {
            if (tweet.text) {
                points.push(`🔥 ${tweet.text} (${tweet.likes ?? 0} likes, ${tweet.retweets ?? 0} RTs)`);
            }
        }

        // Topic summaries
        const topics = this.groupByTopic(tweets);
        const topTopics = Object.entries(topics)
            .sort(([, a], [, b]) => ((b[0]?.likes ?? 0) + (b[0]?.retweets ?? 0)) - ((a[0]?.likes ?? 0) + (a[0]?.retweets ?? 0)))
            .slice(0, 2);

        for (const [topic, topicTweets] of topTopics) {
            const mainTweet = topicTweets[0];
            if (mainTweet?.text) {
                points.push(`📝 Topic "${topic}": ${mainTweet.text}`);
            }
        }

        return points.slice(0, this.config.maxBulletPoints);
    }

    private groupByTopic(tweets: ReadonlyArray<Tweet>): Record<string, Tweet[]> {
        const topics: Record<string, Tweet[]> = {};

        for (const tweet of tweets) {
            if (tweet.text) {
                const topic = this.extractMainTopic(tweet.text);
                if (!topic) continue;

                if (!topics[topic]) topics[topic] = [];
                topics[topic].push(tweet);
            }
        }

        return topics;
    }

    private extractMainTopic(text: string): string | null {
        const words = text
            .toLowerCase()
            .replace(/https?:\/\/\S+/g, '')
            .replace(/@\w+/g, '')
            .replace(/[^\w\s#]/g, '')
            .split(/\s+/)
            .filter(w => !this.config.commonWords.has(w));

        // Try to find a hashtag first
        const hashtag = words.find(w => w.startsWith('#'));
        if (hashtag) return hashtag.slice(1);

        // Otherwise use most frequent meaningful word
        const wordCounts = words.reduce((acc, word) => {
            acc[word] = (acc[word] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const [mainTopic] = Object.entries(wordCounts)
            .sort(([, a], [, b]) => b - a)[0] || [];

        return mainTopic || null;
    }

    private isWithinPeriod(date: Date, period: AnalysisPeriod): boolean {
        return date >= period.start && date <= period.end;
    }
}