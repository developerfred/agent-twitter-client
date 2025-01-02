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
        userId: string,
        period: AnalysisPeriod,
        maxFollows = 100
    ): Promise<ReadonlyArray<BulletSummary>> {
        const follows = await this.getFollowedUsers(userId, maxFollows);
        return this.generateBulletPoints(follows, period);
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
            if (this.isWithinPeriod(new Date(tweet.date), period)) {
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
            const tweets = await this.getTimelineTweets(follow.userId, period);
            if (tweets.length > 0) {
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
            .filter(t => (t.likes + t.retweets) > this.config.minEngagement)
            .sort((a, b) => (b.likes + b.retweets) - (a.likes + a.retweets))
            .slice(0, 3);

        for (const tweet of topTweets) {
            points.push(`🔥 ${tweet.text} (${tweet.likes} likes, ${tweet.retweets} RTs)`);
        }

        // Topic summaries
        const topics = this.groupByTopic(tweets);
        const topTopics = Object.entries(topics)
            .sort(([, a], [, b]) => b.length - a.length)
            .slice(0, 2);

        for (const [topic, topicTweets] of topTopics) {
            const mainTweet = topicTweets.sort(
                (a, b) => (b.likes + b.retweets) - (a.likes + a.retweets)
            )[0];

            points.push(`📝 Topic "${topic}": ${mainTweet.text}`);
        }

        return points.slice(0, this.config.maxBulletPoints);
    }

    private groupByTopic(tweets: ReadonlyArray<Tweet>): Record<string, Tweet[]> {
        const topics: Record<string, Tweet[]> = {};

        for (const tweet of tweets) {
            const topic = this.extractMainTopic(tweet.text);
            if (!topic) continue;

            if (!topics[topic]) topics[topic] = [];
            topics[topic].push(tweet);
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