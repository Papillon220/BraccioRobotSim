classdef BraccioWebRobot < matlab.System
%BRACCIOWEBROBOT Block "Web Robot" - Ersatz fuer Simulation 3D Robot.
%
%   Eingang Config: Gelenkkonfiguration wie am Block Simulation 3D Robot
%   (braccioRobotVis: q1..q5 [rad], danach die Gelenke des Greifers aus
%   Braccio_gripperJoints). Aus dem Zahnradwinkel Config(6) wird der
%   Servowinkel q6 zurueckgerechnet: q6 = Config(6)/GripperGain + GripperQ6
%   (braccioGripper.servoGain, braccioGripper.q6_stl aus Braccio_gripperSetup).
%   Ist Config nur 5 Elemente lang, bleibt der Greifer offen.
%
%   F. Bender, DHBW Stuttgart

    properties (Nontunable)
        ActorName = 'braccioRobot'  % Name wie am Block Simulation 3D Robot
        GripperGain = 1             % Uebersetzung Servo -> Zahnrad (braccioGripper.servoGain)
        GripperQ6 = 0               % Servowinkel der STL-Lage [rad] (braccioGripper.q6_stl)
    end

    methods
        function obj = BraccioWebRobot(varargin)
            setProperties(obj, nargin, varargin{:});
        end
    end

    methods (Access = protected)
        function stepImpl(obj, Config)
            c = double(Config(:)');
            q6 = 10*pi/180;
            if numel(c) >= 6
                q6 = c(6)/obj.GripperGain + obj.GripperQ6;   % Umkehrung von Braccio_gripperJoints
            end
            BraccioWebHub.instance().setRobot(c(1:5), q6);
        end

        function name = getInputNamesImpl(~)
            name = 'Config';
        end

        function icon = getIconImpl(~)
            icon = sprintf('Web Robot\n(BraccioSim)');
        end
    end

    methods (Static, Access = protected)
        function header = getHeaderImpl
            header = matlab.system.display.Header('BraccioWebRobot', 'Title', 'Web Robot', ...
                'Text', 'Ersatz fuer Simulation 3D Robot: uebertraegt die Gelenkkonfiguration an BraccioSim.');
        end
    end
end
