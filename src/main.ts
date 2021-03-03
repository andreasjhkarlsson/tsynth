

import "speaker"
import Speaker from "speaker";
import {Readable} from "stream"
import {hrtime} from "process"
import { exception } from "console";

// Time in seconds -> sample between -1.0 and 1.0
type Source = (time: number) => number;

class ActiveSource
{
    samplesGenerated: number;
    constructor(private source: (t: number) => number, private sampleRate: number, public startAt: number, public stopAt: number)
    {
        this.samplesGenerated = 0;
    }

    nextSample()
    {

        let sample = this.source(this.samplesGenerated / this.sampleRate);
        this.samplesGenerated++;
        return sample / 2.0;
    }
}

class Device
{
    speaker: Speaker;
    buffer: Readable;
    totalSamples: number;
    activeSources: ActiveSource[];
    startTime: bigint;

    constructor(private sampleRate: number, private chunkSize: number)
    {
        this.speaker = new Speaker({
            channels: 1,
            bitDepth: 16,
            sampleRate: sampleRate,    
            lowWaterMark: chunkSize,
            highWaterMark: chunkSize*2});

        this.activeSources = new Array<ActiveSource>();
        
        this.totalSamples = 0;

        this.buffer = new Readable({read: () => this.pushPCM()});

        this.startTime = BigInt(0);
    }

    start()
    {
        this.startTime = hrtime.bigint();
        
        // Start device with one second delay to make sure it doesn't gobble up our samples
        setTimeout(() => {
            this.buffer.pipe(this.speaker);
        }, 1000);
    }

    private generateSample()
    {
        let tis = this.totalSamples;
        var sample = 0;
        for (let activeSource of this.activeSources) {
            if (activeSource.startAt < tis && activeSource.stopAt > tis)
                sample += activeSource.nextSample();
        }

        // Clip
        if (sample > 0.9)
            sample = 0.9;
        else if (sample < -0.9)
            sample = -0.9;

        // Remove finished sources
        this.activeSources = this.activeSources.filter((as) => as.stopAt > tis);

        this.totalSamples++;

        return sample;
    }

    getTime()
    {
        return Number((hrtime.bigint() - this.startTime) / BigInt(1000000)) / 1000.0;
    }

    getTimeInSamples()
    {
        return this.getTime() * this.sampleRate;
    }

    addSource(source: (time: number) => number, length: number)
    {
        let tis = this.getTimeInSamples();
        this.activeSources.push(new ActiveSource(source,this.sampleRate, tis, tis + length*this.sampleRate));
    }

    private pushPCM() {

        function f2i(sample: number): number
        {
            return (sample + 1.0) / 2.0 * 65535 - 32768;
        }

        let chunk = Buffer.alloc(this.chunkSize * 2);
        for(var s=0;s<this.chunkSize;s++)
        {
            let sample = this.generateSample();
            chunk.writeInt16LE(f2i(sample), s*2);
        }
        this.buffer.push(chunk); 
    }
}

let device = new Device(44100, 1024);

device.start();

let silence: Source = _ => 0.0;

function square(f: number, a: number): Source
{
    return t => {
        if (Math.sin(t*f) > 0.0)
            return 1.0 * a;
        else
            return -1.0 * a;
    };    
}

function sine(f: number, a: number): Source
{
    return t => Math.sin(t * f) * a;   
}

function mix3(s1: Source,s2: Source,s3: Source): Source
{
    return t => s1(t) + s2(t) + s3(t);
}

function fade(source: Source, x: number): Source
{
    return t => source(t) / Math.exp(t*x);
}

function note(name: string, oct: number)
{
    function source(f: number)
    {
        return mix3(
            fade(sine(f / 1.0, 0.50), 4.0),
            fade(sine(f / 2.0, 0.15), 6.0),
            fade(sine(f * 2.0, 0.15), 4.0)
        );
    }
    switch (name.toLocaleLowerCase())
    {
        case "c":
            return source(261.63 * Math.pow(2,oct));
        case "c#":
            return source(277.18 * Math.pow(2,oct));
        case "d":
            return source(293.66 * Math.pow(2,oct));
        case "d#":
            return source(311.13 * Math.pow(2,oct));
        case "e":
            return source(329.63 * Math.pow(2,oct));
        case "f":
            return source(349.23 * Math.pow(2,oct));
        case "f#":
            return source(369.99 * Math.pow(2,oct));
        case "g":
            return source(392.00 * Math.pow(2,oct));
        case "g#":
            return source(415.13 * Math.pow(2,oct));
        case "a":
            return source(440.0 * Math.pow(2,oct));
        case "a#":
            return source(466.16 * Math.pow(2,oct));
        case "b":
            return source(493.88 * Math.pow(2,oct));
        default:
            throw exception("invalid note");
    }
}

function octave(oct: number)
{
    return (name: string) => note(name, oct);
}

let octaves = [
    octave(0),
    octave(1),
    octave(2),
    octave(3),
    octave(4),
];

/*
zelda's lullaby
E, G, D x2
E, G, D(↑), C(↑), G
*/
let low = 2;
let high = 3;
let sheet = [
    octaves[low]("e"),
    octaves[low]("g"),
    octaves[low]("d"),
    silence,
    octaves[low]("e"),
    octaves[low]("g"),
    octaves[low]("d"),
    silence,
    octaves[low]("e"),
    octaves[low]("g"),
    octaves[high]("d"),
    octaves[high]("c"),
    octaves[low]("g"),

];

function play(sheet:Array<Source>, speed: number)
{
    for(let i=0;i<sheet.length;i++)
    {
        setTimeout(() => {
            device.addSource(sheet[i], 5.0);
        }, i*speed);
    }
}

play(sheet, 400);