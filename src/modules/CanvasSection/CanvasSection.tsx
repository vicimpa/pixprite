import { Component } from "react";
import { Flex } from "$ui/Flex";
import { signalRef } from "$utils/signal";
import { prop, reactive, real } from "@vicimpa/decorators";
import { Mat2d, vec2 } from "@vicimpa/glm";
import { connect, inject } from "@vicimpa/react-decorators";
import { computed } from "@preact/signals-react";
import detectResize from "./plugins/detectResize";
import detectMatrix from "./plugins/detectMatrix";
import detectRender from "./plugins/detectRender";
import equal from "fast-deep-equal";
import detectInput from "./plugins/detectInput";
import { InfoView } from "$modules/InfoView";
import { Grid } from "$core/Grid";
import styled from "styled-components";
import { SpriteEditor } from "$modules/SpriteEditor/SpriteEditor";
import { Panel } from "$ui/Panel";

const DEFAULT_VIEW = {
  width: 64,
  height: 64,
  // aspect: 1,
};

type View = typeof DEFAULT_VIEW;

const Canvas = styled.canvas`
  image-rendering: pixelated;
  pointer-events: none;
`;

export type CanvasSectionProps = Partial<View>;

@reactive()
@connect(detectResize, detectMatrix, detectRender, detectInput)
export class CanvasSection extends Component<CanvasSectionProps> {
  @inject(() => SpriteEditor) editor!: SpriteEditor;

  ref = signalRef<HTMLDivElement>();
  @prop grid = new Grid();

  @prop real = vec2(-Infinity);
  @prop umouse = vec2();
  @prop mouse = vec2();
  @prop drag = false;
  @prop down = false;
  @prop alt = false;

  @prop scale = 10;
  @prop pos = vec2();
  @prop size = vec2();
  @prop matrix = new Mat2d();
  @prop get invMatrix() {
    return this.matrix.clone().invert();
  }

  @prop view: View = Object.assign({}, DEFAULT_VIEW);
  @prop object = [];


  can = signalRef<HTMLCanvasElement>();
  ctx = computed(() => this.can.value?.getContext('2d'));

  componentDidMount(): void {
    this.view = Object.assign({}, this.view, this.props);
  }

  componentDidUpdate(prev: CanvasSectionProps): void {
    if (equal(prev, this.props))
      return;
    this.componentDidMount();
  }

  info = computed(() => {
    const { x, y } = this.mouse;
    const { width, height } = this.view;

    return (
      <Flex gap={8}>
        <i className="i-cross" />
        <p>{x} {y}</p>
        <i className="i-rect" />
        <p>{width} {height}</p>
      </Flex>
    );
  });

  render() {
    return (
      <>
        <Flex size={32}></Flex>
        <Flex size>
          <Panel className="relative" $width={'100%'} $height={'100%'}>
            <InfoView.Item info={this.info}>
              <div ref={this.ref} className="absolute inset-0">
                <Canvas ref={this.can} />
              </div>
            </InfoView.Item>
          </Panel>
        </Flex >
      </>
    );
  }
}